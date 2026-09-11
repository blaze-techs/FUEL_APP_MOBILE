/**
 * useFounderAdvancedStore — cloud-backed, real-time store for the advanced
 * Founder Access Global Console datasets.
 *
 * This hook extends the original `useFounderConsoleStore` (secrets / flags /
 * audit / settings) with 14 additional cloud-backed datasets, each real-time
 * synced across every signed-in founder device via Supabase `app_kv` +
 * Realtime. Any change made in the console on one device is written to the
 * cloud row AND broadcast instantly to every other subscribed device — zero
 * polling.
 *
 * Datasets managed here:
 *   - founder_console_webhooks
 *   - founder_console_apikeys
 *   - founder_console_announcements
 *   - founder_console_maintenance_windows
 *   - founder_console_blocklist
 *   - founder_console_cors
 *   - founder_console_envvars
 *   - founder_console_jobs
 *   - founder_console_experiments
 *   - founder_console_health_checks
 *   - founder_console_localization
 *   - founder_console_secret_access
 *   - founder_console_error_tracker
 *   - founder_console_sessions
 *   - founder_console_task_queue
 *   - founder_console_log_streams
 *   - founder_console_role_matrix
 *   - founder_console_release_coord
 *   - founder_console_migrations
 *   - founder_console_webhook_deliveries
 *   - founder_console_storage_explorer
 *   - founder_console_api_rate_limits
 *
 * All keys are owner-scoped by cloudStorageService (RLS `auth.uid() = owner_id`)
 * so founder accounts are isolated. localStorage is only a read-through cache.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import cloudStorageService from "@/react-app/lib/cloud-storage-service";

/* ───────────────────────── Types ───────────────────────── */

export interface WebhookConfig {
  id: string;
  name: string;
  url: string;
  events: string[]; // e.g. ["sale.completed", "user.created"]
  active: boolean;
  secret: string; // signing secret (masked in UI)
  retryCount: number;
  retryDelayMs: number;
  timeoutMs: number;
  createdAt: string;
  updatedAt?: string;
  lastTriggered?: string;
  lastStatus?: "success" | "failed" | "pending";
}

export interface ApiKeyConfig {
  id: string;
  name: string;
  key: string; // the actual key (masked in UI)
  scopes: string[];
  rateLimitPerMin: number;
  expiresAt?: string;
  active: boolean;
  createdAt: string;
  updatedAt?: string;
  lastUsed?: string;
  usageCount: number;
}

export type AnnouncementType = "info" | "success" | "warning" | "danger";
export type AnnouncementTarget = "all" | "founders" | "users" | "station";

export interface AnnouncementConfig {
  id: string;
  title: string;
  message: string;
  type: AnnouncementType;
  target: AnnouncementTarget;
  active: boolean;
  dismissible: boolean;
  startsAt?: string;
  endsAt?: string;
  createdAt: string;
  updatedAt?: string;
  dismissCount: number;
}

export interface MaintenanceWindow {
  id: string;
  title: string;
  message: string;
  startsAt: string;
  endsAt: string;
  active: boolean;
  showBanner: boolean;
  affectedServices: string[];
  createdAt: string;
  updatedAt?: string;
}

export interface BlocklistEntry {
  id: string;
  ip: string;
  reason: string;
  addedBy: string;
  expiresAt?: string; // undefined = permanent
  createdAt: string;
  active: boolean;
}

export interface CorsOrigin {
  id: string;
  origin: string; // exact or wildcard pattern
  allowCredentials: boolean;
  allowedMethods: string[];
  createdAt: string;
}

export interface EnvVar {
  id: string;
  key: string;
  value: string; // masked in UI
  masked: boolean; // whether the value is secret
  category: string;
  createdAt: string;
  updatedAt?: string;
}

export type JobStatus = "idle" | "running" | "success" | "failed" | "disabled";

export interface ScheduledJob {
  id: string;
  name: string;
  description: string;
  schedule: string; // cron expression
  enabled: boolean;
  lastRun?: string;
  lastStatus: JobStatus;
  lastDurationMs?: number;
  endpoint: string;
  createdAt: string;
}

export type ExperimentStatus = "draft" | "running" | "paused" | "completed";

export interface ExperimentVariant {
  id: string;
  name: string;
  weight: number; // 0-100
  description?: string;
}

export interface Experiment {
  id: string;
  name: string;
  description: string;
  status: ExperimentStatus;
  variants: ExperimentVariant[];
  metric: string;
  startDate?: string;
  endDate?: string;
  createdAt: string;
  updatedAt?: string;
}

export interface HealthCheck {
  id: string;
  name: string;
  url: string;
  expectedStatus: number;
  intervalSec: number;
  enabled: boolean;
  lastChecked?: string;
  lastStatus?: "up" | "down" | "unknown";
  lastLatencyMs?: number;
  createdAt: string;
}

export interface LocalizationLanguage {
  id: string;
  code: string; // e.g. "en", "sw"
  name: string;
  nativeName: string;
  active: boolean;
  isDefault: boolean;
  coverage: number; // 0-100 translation coverage
  createdAt: string;
}

export interface SecretAccessLogEntry {
  id: string;
  secretKey: string;
  accessedBy: string;
  action: "view" | "rotate" | "update" | "delete" | "create";
  timestamp: string;
  ip?: string;
}

/* ─── Batch 2 types: additional developer-control datasets ─── */

export interface ErrorLogEntry {
  id: string;
  message: string;
  stack?: string;
  source: "client" | "server" | "api" | "webhook";
  severity: "error" | "warning" | "fatal";
  url?: string;
  userAgent?: string;
  userId?: string;
  count: number;
  firstSeen: string;
  lastSeen: string;
  resolved: boolean;
  fingerprint: string;
}

export interface UserSession {
  id: string;
  userId: string;
  email: string;
  device: "desktop" | "mobile" | "tablet";
  browser: string;
  os: string;
  ip: string;
  location?: string;
  loginAt: string;
  lastActiveAt: string;
  active: boolean;
  tokenExpiresAt?: string;
}

export type TaskStatus =
  "queued" | "running" | "completed" | "failed" | "retrying";
export type TaskPriority = "low" | "normal" | "high" | "critical";

export interface TaskQueueItem {
  id: string;
  name: string;
  type:
    "email" | "sync" | "export" | "import" | "report" | "cleanup" | "custom";
  status: TaskStatus;
  priority: TaskPriority;
  payload?: string;
  progress: number; // 0-100
  result?: string;
  error?: string;
  attempts: number;
  maxAttempts: number;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  scheduledFor?: string;
}

export type LogLevel = "debug" | "info" | "warn" | "error" | "fatal";
export type LogSource =
  "auth" | "api" | "db" | "realtime" | "storage" | "worker" | "cron" | "ui";

export interface LogStreamEntry {
  id: string;
  level: LogLevel;
  source: LogSource;
  message: string;
  metadata?: string;
  timestamp: string;
  traceId?: string;
}

export type PermissionAction =
  "read" | "write" | "delete" | "admin" | "export" | "import";

export interface RolePermission {
  id: string;
  role: string; // founder, admin, manager, cashier, user
  resource: string; // e.g. "stations", "sales", "reports"
  actions: PermissionAction[];
  granted: boolean;
  updatedAt: string;
}

export type ReleaseStatus =
  "draft" | "canary" | "rolling" | "live" | "paused" | "rolled-back";

export interface ReleaseCoordinator {
  id: string;
  name: string;
  version: string;
  description: string;
  status: ReleaseStatus;
  rolloutPercent: number; // 0-100
  targetPercent: number;
  enabledFlags: string[]; // feature flag ids to enable
  cohortSize: number;
  affectedUsers: number;
  createdAt: string;
  updatedAt: string;
  promotedAt?: string;
  notes?: string;
}

export type MigrationStatus =
  "pending" | "applied" | "failed" | "rolled-back" | "skipped";

export interface MigrationRecord {
  id: string;
  filename: string;
  description: string;
  status: MigrationStatus;
  appliedAt?: string;
  durationMs?: number;
  tablesAffected: string[];
  error?: string;
  checksum?: string;
}

export type DeliveryStatus =
  "pending" | "success" | "failed" | "retrying" | "timeout";

export interface WebhookDelivery {
  id: string;
  webhookId: string;
  webhookName: string;
  event: string;
  url: string;
  status: DeliveryStatus;
  statusCode?: number;
  requestBody: string;
  responseBody?: string;
  responseHeaders?: string;
  attempt: number;
  latencyMs?: number;
  queuedAt: string;
  deliveredAt?: string;
  nextRetryAt?: string;
  errorMessage?: string;
}

export interface StorageBucketItem {
  id: string;
  bucketName: string;
  path: string;
  name: string;
  size: number;
  mimeType: string;
  isFolder: boolean;
  publicUrl?: string;
  uploadedAt: string;
  uploadedBy?: string;
}

export interface ApiRateLimitEntry {
  id: string;
  endpoint: string; // e.g. "/api/fuel-local"
  method: string; // GET, POST
  limitPerMin: number;
  windowMs: number;
  currentCount: number;
  burstLimit: number;
  enabled: boolean;
  strategy: "fixed" | "sliding" | "token-bucket" | "leaky-bucket";
  lastHitAt?: string;
  topIps?: string[];
  updatedAt: string;
}

/* ───────────────────────── Keys ───────────────────────── */

const KEYS = {
  webhooks: "founder_console_webhooks",
  apikeys: "founder_console_apikeys",
  announcements: "founder_console_announcements",
  maintenance: "founder_console_maintenance_windows",
  blocklist: "founder_console_blocklist",
  cors: "founder_console_cors",
  envvars: "founder_console_envvars",
  jobs: "founder_console_jobs",
  experiments: "founder_console_experiments",
  health: "founder_console_health_checks",
  localization: "founder_console_localization",
  secretAccess: "founder_console_secret_access",
  errorTracker: "founder_console_error_tracker",
  sessions: "founder_console_sessions",
  taskQueue: "founder_console_task_queue",
  logStreams: "founder_console_log_streams",
  roleMatrix: "founder_console_role_matrix",
  releaseCoord: "founder_console_release_coord",
  migrations: "founder_console_migrations",
  webhookDeliveries: "founder_console_webhook_deliveries",
  storageExplorer: "founder_console_storage_explorer",
  apiRateLimits: "founder_console_api_rate_limits",
} as const;

/* ───────────────────────── Defaults ───────────────────────── */

const DEFAULT_WEBHOOK_EVENTS = [
  "sale.completed",
  "user.created",
  "user.deleted",
  "station.created",
  "station.updated",
  "flag.toggled",
  "secret.rotated",
  "payment.received",
  "payment.failed",
  "invoice.created",
];

const DEFAULT_API_SCOPES = [
  "read:stations",
  "write:stations",
  "read:users",
  "write:users",
  "read:sales",
  "write:sales",
  "read:reports",
  "admin:all",
];

const DEFAULT_CORS_METHODS = [
  "GET",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "OPTIONS",
];

const DEFAULT_ENV_CATEGORIES = [
  "Auth",
  "API",
  "Database",
  "Payments",
  "Feature",
];

const DEFAULT_LANGUAGES: LocalizationLanguage[] = [
  {
    id: "en",
    code: "en",
    name: "English",
    nativeName: "English",
    active: true,
    isDefault: true,
    coverage: 100,
    createdAt: new Date().toISOString(),
  },
  {
    id: "sw",
    code: "sw",
    name: "Swahili",
    nativeName: "Kiswahili",
    active: true,
    isDefault: false,
    coverage: 78,
    createdAt: new Date().toISOString(),
  },
];

const DEFAULT_JOBS: ScheduledJob[] = [
  {
    id: "fuel-price-sync",
    name: "Monthly Fuel Price Sync",
    description: "Refresh cached fuel prices for the most-queried locations",
    schedule: "0 0 1 * *",
    enabled: true,
    lastStatus: "success",
    endpoint: "/api/cron/monthly-fuel-sync",
    createdAt: new Date().toISOString(),
  },
  {
    id: "audit-archive",
    name: "Audit Log Archive",
    description: "Archive audit entries older than the retention threshold",
    schedule: "0 3 * * 0",
    enabled: false,
    lastStatus: "idle",
    endpoint: "/api/cron/audit-archive",
    createdAt: new Date().toISOString(),
  },
];

/* ─── Batch 2 defaults ─── */

const DEFAULT_ROLES = ["founder", "admin", "manager", "cashier", "user"];

const DEFAULT_RESOURCES = [
  "stations",
  "sales",
  "products",
  "inventory",
  "invoices",
  "reports",
  "expenses",
  "customers",
  "suppliers",
  "payroll",
  "shifts",
  "credit",
  "fuel_types",
  "documents",
  "integrations",
  "founder_panel",
];

const DEFAULT_ROLE_MATRIX: RolePermission[] = DEFAULT_ROLES.flatMap((role) =>
  DEFAULT_RESOURCES.map((res) => ({
    id: `${role}-${res}`,
    role,
    resource: res,
    actions:
      role === "founder"
        ? ["read", "write", "delete", "admin", "export", "import"]
        : role === "admin"
          ? ["read", "write", "export"]
          : role === "manager"
            ? ["read", "write"]
            : role === "cashier"
              ? ["read"]
              : [],
    granted: role === "founder" || role === "admin" || role === "manager",
    updatedAt: new Date().toISOString(),
  })),
);

const DEFAULT_API_RATE_LIMITS: ApiRateLimitEntry[] = [
  {
    id: "fuel-local",
    endpoint: "/api/fuel-local",
    method: "GET",
    limitPerMin: 60,
    windowMs: 60000,
    currentCount: 0,
    burstLimit: 10,
    enabled: true,
    strategy: "sliding",
    updatedAt: new Date().toISOString(),
  },
  {
    id: "fuel-prices",
    endpoint: "/api/fuel-prices",
    method: "GET",
    limitPerMin: 100,
    windowMs: 60000,
    currentCount: 0,
    burstLimit: 20,
    enabled: true,
    strategy: "token-bucket",
    updatedAt: new Date().toISOString(),
  },
  {
    id: "founder-stats",
    endpoint: "/api/founder-stats",
    method: "GET",
    limitPerMin: 30,
    windowMs: 60000,
    currentCount: 0,
    burstLimit: 5,
    enabled: true,
    strategy: "fixed",
    updatedAt: new Date().toISOString(),
  },
  {
    id: "trpc",
    endpoint: "/api/trpc/*",
    method: "POST",
    limitPerMin: 200,
    windowMs: 60000,
    currentCount: 0,
    burstLimit: 50,
    enabled: true,
    strategy: "leaky-bucket",
    updatedAt: new Date().toISOString(),
  },
];

const DEFAULT_RELEASES: ReleaseCoordinator[] = [
  {
    id: "v2-autofuel",
    name: "Auto Fuel Price Engine v2",
    version: "2.1.0",
    description: "Hyper-local GPS fuel price detection with smart-cache",
    status: "live",
    rolloutPercent: 100,
    targetPercent: 100,
    enabledFlags: ["auto_fuel_price"],
    cohortSize: 0,
    affectedUsers: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    promotedAt: new Date().toISOString(),
  },
  {
    id: "v2-realtime",
    name: "Real-time Cross-device Sync",
    version: "2.2.0",
    description: "Supabase Realtime pub/sub for instant cross-device updates",
    status: "rolling",
    rolloutPercent: 50,
    targetPercent: 100,
    enabledFlags: ["realtime_sync"],
    cohortSize: 0,
    affectedUsers: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
];

const DEFAULT_MIGRATIONS: MigrationRecord[] = [
  {
    id: "005",
    filename: "005_saleszote_features.sql",
    description:
      "POS module tables (products, sales_enhanced, sale_items, expenses)",
    status: "applied",
    appliedAt: new Date(Date.now() - 86400000 * 3).toISOString(),
    durationMs: 1240,
    tablesAffected: [
      "products",
      "sales_enhanced",
      "sale_items",
      "inventory_transactions",
    ],
    checksum: "a1b2c3",
  },
  {
    id: "012",
    filename: "012_fuel_prices_postgis.sql",
    description: "fuel_prices table + PostGIS spatial index + RPCs",
    status: "applied",
    appliedAt: new Date(Date.now() - 86400000 * 2).toISOString(),
    durationMs: 890,
    tablesAffected: ["fuel_prices"],
    checksum: "d4e5f6",
  },
  {
    id: "013",
    filename: "013_founder_2fa_profiles.sql",
    description: "Founder 2FA, recovery codes, unique_id on profiles",
    status: "applied",
    appliedAt: new Date(Date.now() - 86400000).toISOString(),
    durationMs: 450,
    tablesAffected: ["profiles"],
    checksum: "g7h8i9",
  },
  {
    id: "014",
    filename: "014_error_tracking.sql",
    description:
      "Pending: error_logs table for client/server error aggregation",
    status: "pending",
    tablesAffected: [],
  },
];

const DEFAULT_STORAGE_ITEMS: StorageBucketItem[] = [
  {
    id: "logos-dir",
    bucketName: "fuelpro-files",
    path: "logos/",
    name: "logos",
    size: 0,
    mimeType: "folder",
    isFolder: true,
    uploadedAt: new Date().toISOString(),
  },
  {
    id: "docs-dir",
    bucketName: "fuelpro-files",
    path: "documents/",
    name: "documents",
    size: 0,
    mimeType: "folder",
    isFolder: true,
    uploadedAt: new Date().toISOString(),
  },
];

const DEFAULT_TASK_TYPES = [
  "email",
  "sync",
  "export",
  "import",
  "report",
  "cleanup",
  "custom",
] as const;

const DEFAULT_LOG_SOURCES: LogSource[] = [
  "auth",
  "api",
  "db",
  "realtime",
  "storage",
  "worker",
  "cron",
  "ui",
];

/* ───────────────────────── Helpers ───────────────────────── */

function uid(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function randomKey(prefix = "fpa"): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  const hex = Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return `${prefix}_${hex}`;
}

function maskValue(value: string, visibleChars = 4): string {
  if (!value) return "";
  if (value.length <= visibleChars) return "•".repeat(value.length);
  return `${value.slice(0, visibleChars)}${"•".repeat(Math.min(value.length - visibleChars, 20))}`;
}

/** Generic cloud-backed real-time list manager for one key. */
function useCloudList<T>(
  key: string,
  stationId: string | undefined,
  defaultValue: T[],
  isValue: (v: unknown) => v is T[],
): {
  data: T[];
  loading: boolean;
  setData: (next: T[]) => void;
  reload: () => void;
} {
  const [data, setDataState] = useState<T[]>(defaultValue);
  const [loading, setLoading] = useState(true);
  const skipEcho = useRef(false);

  const load = useCallback(async () => {
    const cloud = await cloudStorageService.get<T[]>(key, stationId);
    if (cloud && isValue(cloud)) {
      setDataState(cloud);
    } else {
      // Use the default locally but DON'T write to cloud here — writing
      // triggers a realtime echo that re-runs setDataState with a new array
      // reference, and with 23 stores doing this on mount the cascade of
      // echoes caused a re-render storm that broke section navigation.
      // The default is persisted lazily on the first real setData() call.
      setDataState(defaultValue);
    }
    setLoading(false);
  }, [key, stationId]); // eslint-disable-line react-hooks/exhaustive-deps

  const loadedRef = useRef(false);
  useEffect(() => {
    if (loadedRef.current) return; // load once per mount, not per re-render
    loadedRef.current = true;
    load();
    const unsub = cloudStorageService.subscribe<T[]>(
      key,
      stationId,
      (value) => {
        if (skipEcho.current) {
          skipEcho.current = false;
          return;
        }
        if (value && isValue(value)) setDataState(value);
      },
    );
    return () => unsub();
  }, [load, key, stationId]); // eslint-disable-line react-hooks/exhaustive-deps

  const setData = useCallback(
    (next: T[]) => {
      skipEcho.current = true;
      setDataState(next);
      cloudStorageService.set(key, next, stationId).catch(() => {});
    },
    [key, stationId],
  );

  const reload = useCallback(() => {
    cloudStorageService.invalidate(key, stationId);
    load();
  }, [load, key, stationId]);

  return { data, loading, setData, reload };
}

const isArr =
  <T>() =>
  (v: unknown): v is T[] =>
    Array.isArray(v);

/* ───────────────────────── Main hook ───────────────────────── */

export function useFounderAdvancedStore(stationId?: string) {
  /* Webhooks */
  const webhooksStore = useCloudList<WebhookConfig>(
    KEYS.webhooks,
    stationId,
    [],
    isArr<WebhookConfig>(),
  );
  /* API Keys */
  const apikeysStore = useCloudList<ApiKeyConfig>(
    KEYS.apikeys,
    stationId,
    [],
    isArr<ApiKeyConfig>(),
  );
  /* Announcements */
  const announcementsStore = useCloudList<AnnouncementConfig>(
    KEYS.announcements,
    stationId,
    [],
    isArr<AnnouncementConfig>(),
  );
  /* Maintenance Windows */
  const maintenanceStore = useCloudList<MaintenanceWindow>(
    KEYS.maintenance,
    stationId,
    [],
    isArr<MaintenanceWindow>(),
  );
  /* Blocklist */
  const blocklistStore = useCloudList<BlocklistEntry>(
    KEYS.blocklist,
    stationId,
    [],
    isArr<BlocklistEntry>(),
  );
  /* CORS Origins */
  const corsStore = useCloudList<CorsOrigin>(
    KEYS.cors,
    stationId,
    [],
    isArr<CorsOrigin>(),
  );
  /* Env Vars */
  const envvarsStore = useCloudList<EnvVar>(
    KEYS.envvars,
    stationId,
    [],
    isArr<EnvVar>(),
  );
  /* Scheduled Jobs */
  const jobsStore = useCloudList<ScheduledJob>(
    KEYS.jobs,
    stationId,
    DEFAULT_JOBS,
    isArr<ScheduledJob>(),
  );
  /* Experiments */
  const experimentsStore = useCloudList<Experiment>(
    KEYS.experiments,
    stationId,
    [],
    isArr<Experiment>(),
  );
  /* Health Checks */
  const healthStore = useCloudList<HealthCheck>(
    KEYS.health,
    stationId,
    [],
    isArr<HealthCheck>(),
  );
  /* Localization */
  const localizationStore = useCloudList<LocalizationLanguage>(
    KEYS.localization,
    stationId,
    DEFAULT_LANGUAGES,
    isArr<LocalizationLanguage>(),
  );
  /* Secret Access Log */
  const secretAccessStore = useCloudList<SecretAccessLogEntry>(
    KEYS.secretAccess,
    stationId,
    [],
    isArr<SecretAccessLogEntry>(),
  );

  /* ─── Batch 2 stores ─── */
  /* Error Tracker */
  const errorTrackerStore = useCloudList<ErrorLogEntry>(
    KEYS.errorTracker,
    stationId,
    [],
    isArr<ErrorLogEntry>(),
  );
  /* Sessions */
  const sessionsStore = useCloudList<UserSession>(
    KEYS.sessions,
    stationId,
    [],
    isArr<UserSession>(),
  );
  /* Task Queue */
  const taskQueueStore = useCloudList<TaskQueueItem>(
    KEYS.taskQueue,
    stationId,
    [],
    isArr<TaskQueueItem>(),
  );
  /* Log Streams */
  const logStreamsStore = useCloudList<LogStreamEntry>(
    KEYS.logStreams,
    stationId,
    [],
    isArr<LogStreamEntry>(),
  );
  /* Role Matrix */
  const roleMatrixStore = useCloudList<RolePermission>(
    KEYS.roleMatrix,
    stationId,
    DEFAULT_ROLE_MATRIX,
    isArr<RolePermission>(),
  );
  /* Release Coordinator */
  const releaseCoordStore = useCloudList<ReleaseCoordinator>(
    KEYS.releaseCoord,
    stationId,
    DEFAULT_RELEASES,
    isArr<ReleaseCoordinator>(),
  );
  /* Migrations */
  const migrationsStore = useCloudList<MigrationRecord>(
    KEYS.migrations,
    stationId,
    DEFAULT_MIGRATIONS,
    isArr<MigrationRecord>(),
  );
  /* Webhook Deliveries */
  const webhookDeliveriesStore = useCloudList<WebhookDelivery>(
    KEYS.webhookDeliveries,
    stationId,
    [],
    isArr<WebhookDelivery>(),
  );
  /* Storage Explorer */
  const storageExplorerStore = useCloudList<StorageBucketItem>(
    KEYS.storageExplorer,
    stationId,
    DEFAULT_STORAGE_ITEMS,
    isArr<StorageBucketItem>(),
  );
  /* API Rate Limits */
  const apiRateLimitsStore = useCloudList<ApiRateLimitEntry>(
    KEYS.apiRateLimits,
    stationId,
    DEFAULT_API_RATE_LIMITS,
    isArr<ApiRateLimitEntry>(),
  );

  /* ─── Webhook actions ─── */
  const upsertWebhook = useCallback(
    (wh: WebhookConfig) => {
      const exists = webhooksStore.data.some((w) => w.id === wh.id);
      const next = exists
        ? webhooksStore.data.map((w) =>
            w.id === wh.id ? { ...wh, updatedAt: new Date().toISOString() } : w,
          )
        : [...webhooksStore.data, wh];
      webhooksStore.setData(next);
    },
    [webhooksStore],
  );
  const deleteWebhook = useCallback(
    (id: string) =>
      webhooksStore.setData(webhooksStore.data.filter((w) => w.id !== id)),
    [webhooksStore],
  );
  const toggleWebhook = useCallback(
    (id: string) =>
      webhooksStore.setData(
        webhooksStore.data.map((w) =>
          w.id === id
            ? { ...w, active: !w.active, updatedAt: new Date().toISOString() }
            : w,
        ),
      ),
    [webhooksStore],
  );
  const rotateWebhookSecret = useCallback(
    (id: string) =>
      webhooksStore.setData(
        webhooksStore.data.map((w) =>
          w.id === id
            ? {
                ...w,
                secret: randomKey("whsec"),
                updatedAt: new Date().toISOString(),
              }
            : w,
        ),
      ),
    [webhooksStore],
  );
  const recordWebhookTrigger = useCallback(
    (id: string, status: "success" | "failed" | "pending") =>
      webhooksStore.setData(
        webhooksStore.data.map((w) =>
          w.id === id
            ? {
                ...w,
                lastTriggered: new Date().toISOString(),
                lastStatus: status,
              }
            : w,
        ),
      ),
    [webhooksStore],
  );

  /* ─── API Key actions ─── */
  const upsertApiKey = useCallback(
    (ak: ApiKeyConfig) => {
      const exists = apikeysStore.data.some((k) => k.id === ak.id);
      const next = exists
        ? apikeysStore.data.map((k) =>
            k.id === ak.id ? { ...ak, updatedAt: new Date().toISOString() } : k,
          )
        : [...apikeysStore.data, ak];
      apikeysStore.setData(next);
    },
    [apikeysStore],
  );
  const deleteApiKey = useCallback(
    (id: string) =>
      apikeysStore.setData(apikeysStore.data.filter((k) => k.id !== id)),
    [apikeysStore],
  );
  const toggleApiKey = useCallback(
    (id: string) =>
      apikeysStore.setData(
        apikeysStore.data.map((k) =>
          k.id === id
            ? { ...k, active: !k.active, updatedAt: new Date().toISOString() }
            : k,
        ),
      ),
    [apikeysStore],
  );
  const rotateApiKey = useCallback(
    (id: string) =>
      apikeysStore.setData(
        apikeysStore.data.map((k) =>
          k.id === id
            ? {
                ...k,
                key: randomKey("fpa"),
                usageCount: 0,
                updatedAt: new Date().toISOString(),
              }
            : k,
        ),
      ),
    [apikeysStore],
  );
  const recordApiKeyUsage = useCallback(
    (id: string) =>
      apikeysStore.setData(
        apikeysStore.data.map((k) =>
          k.id === id
            ? {
                ...k,
                usageCount: k.usageCount + 1,
                lastUsed: new Date().toISOString(),
              }
            : k,
        ),
      ),
    [apikeysStore],
  );

  /* ─── Announcement actions ─── */
  const upsertAnnouncement = useCallback(
    (a: AnnouncementConfig) => {
      const exists = announcementsStore.data.some((x) => x.id === a.id);
      const next = exists
        ? announcementsStore.data.map((x) =>
            x.id === a.id ? { ...a, updatedAt: new Date().toISOString() } : x,
          )
        : [...announcementsStore.data, a];
      announcementsStore.setData(next);
    },
    [announcementsStore],
  );
  const deleteAnnouncement = useCallback(
    (id: string) =>
      announcementsStore.setData(
        announcementsStore.data.filter((a) => a.id !== id),
      ),
    [announcementsStore],
  );
  const toggleAnnouncement = useCallback(
    (id: string) =>
      announcementsStore.setData(
        announcementsStore.data.map((a) =>
          a.id === id
            ? { ...a, active: !a.active, updatedAt: new Date().toISOString() }
            : a,
        ),
      ),
    [announcementsStore],
  );
  const recordDismiss = useCallback(
    (id: string) =>
      announcementsStore.setData(
        announcementsStore.data.map((a) =>
          a.id === id ? { ...a, dismissCount: a.dismissCount + 1 } : a,
        ),
      ),
    [announcementsStore],
  );

  /* ─── Maintenance window actions ─── */
  const upsertMaintenance = useCallback(
    (m: MaintenanceWindow) => {
      const exists = maintenanceStore.data.some((x) => x.id === m.id);
      const next = exists
        ? maintenanceStore.data.map((x) =>
            x.id === m.id ? { ...m, updatedAt: new Date().toISOString() } : x,
          )
        : [...maintenanceStore.data, m];
      maintenanceStore.setData(next);
    },
    [maintenanceStore],
  );
  const deleteMaintenance = useCallback(
    (id: string) =>
      maintenanceStore.setData(
        maintenanceStore.data.filter((m) => m.id !== id),
      ),
    [maintenanceStore],
  );
  const toggleMaintenance = useCallback(
    (id: string) =>
      maintenanceStore.setData(
        maintenanceStore.data.map((m) =>
          m.id === id
            ? { ...m, active: !m.active, updatedAt: new Date().toISOString() }
            : m,
        ),
      ),
    [maintenanceStore],
  );

  /* ─── Blocklist actions ─── */
  const addBlocklist = useCallback(
    (entry: BlocklistEntry) =>
      blocklistStore.setData([entry, ...blocklistStore.data]),
    [blocklistStore],
  );
  const deleteBlocklist = useCallback(
    (id: string) =>
      blocklistStore.setData(blocklistStore.data.filter((b) => b.id !== id)),
    [blocklistStore],
  );
  const toggleBlocklist = useCallback(
    (id: string) =>
      blocklistStore.setData(
        blocklistStore.data.map((b) =>
          b.id === id ? { ...b, active: !b.active } : b,
        ),
      ),
    [blocklistStore],
  );
  const bulkAddBlocklist = useCallback(
    (entries: BlocklistEntry[]) =>
      blocklistStore.setData([...entries, ...blocklistStore.data]),
    [blocklistStore],
  );
  const clearBlocklist = useCallback(
    () => blocklistStore.setData([]),
    [blocklistStore],
  );

  /* ─── CORS actions ─── */
  const upsertCors = useCallback(
    (c: CorsOrigin) => {
      const exists = corsStore.data.some((x) => x.id === c.id);
      const next = exists
        ? corsStore.data.map((x) => (x.id === c.id ? c : x))
        : [...corsStore.data, c];
      corsStore.setData(next);
    },
    [corsStore],
  );
  const deleteCors = useCallback(
    (id: string) =>
      corsStore.setData(corsStore.data.filter((c) => c.id !== id)),
    [corsStore],
  );

  /* ─── Env var actions ─── */
  const upsertEnvVar = useCallback(
    (e: EnvVar) => {
      const exists = envvarsStore.data.some((x) => x.id === e.id);
      const next = exists
        ? envvarsStore.data.map((x) =>
            x.id === e.id ? { ...e, updatedAt: new Date().toISOString() } : x,
          )
        : [...envvarsStore.data, e];
      envvarsStore.setData(next);
    },
    [envvarsStore],
  );
  const deleteEnvVar = useCallback(
    (id: string) =>
      envvarsStore.setData(envvarsStore.data.filter((e) => e.id !== id)),
    [envvarsStore],
  );
  const bulkImportEnvVars = useCallback(
    (entries: EnvVar[]) =>
      envvarsStore.setData([...envvarsStore.data, ...entries]),
    [envvarsStore],
  );

  /* ─── Job actions ─── */
  const toggleJob = useCallback(
    (id: string) =>
      jobsStore.setData(
        jobsStore.data.map((j) =>
          j.id === id ? { ...j, enabled: !j.enabled } : j,
        ),
      ),
    [jobsStore],
  );
  const runJobNow = useCallback(
    (id: string) =>
      jobsStore.setData(
        jobsStore.data.map((j) =>
          j.id === id
            ? {
                ...j,
                lastStatus: "running",
                lastRun: new Date().toISOString(),
              }
            : j,
        ),
      ),
    [jobsStore],
  );
  const finishJob = useCallback(
    (id: string, status: "success" | "failed", durationMs: number) =>
      jobsStore.setData(
        jobsStore.data.map((j) =>
          j.id === id
            ? {
                ...j,
                lastStatus: status,
                lastDurationMs: durationMs,
                lastRun: new Date().toISOString(),
              }
            : j,
        ),
      ),
    [jobsStore],
  );
  const upsertJob = useCallback(
    (job: ScheduledJob) => {
      const exists = jobsStore.data.some((j) => j.id === job.id);
      const next = exists
        ? jobsStore.data.map((j) => (j.id === job.id ? job : j))
        : [...jobsStore.data, job];
      jobsStore.setData(next);
    },
    [jobsStore],
  );
  const deleteJob = useCallback(
    (id: string) =>
      jobsStore.setData(jobsStore.data.filter((j) => j.id !== id)),
    [jobsStore],
  );

  /* ─── Experiment actions ─── */
  const upsertExperiment = useCallback(
    (e: Experiment) => {
      const exists = experimentsStore.data.some((x) => x.id === e.id);
      const next = exists
        ? experimentsStore.data.map((x) =>
            x.id === e.id ? { ...e, updatedAt: new Date().toISOString() } : x,
          )
        : [...experimentsStore.data, e];
      experimentsStore.setData(next);
    },
    [experimentsStore],
  );
  const deleteExperiment = useCallback(
    (id: string) =>
      experimentsStore.setData(
        experimentsStore.data.filter((e) => e.id !== id),
      ),
    [experimentsStore],
  );
  const setExperimentStatus = useCallback(
    (id: string, status: ExperimentStatus) =>
      experimentsStore.setData(
        experimentsStore.data.map((e) =>
          e.id === id
            ? { ...e, status, updatedAt: new Date().toISOString() }
            : e,
        ),
      ),
    [experimentsStore],
  );

  /* ─── Health check actions ─── */
  const upsertHealthCheck = useCallback(
    (h: HealthCheck) => {
      const exists = healthStore.data.some((x) => x.id === h.id);
      const next = exists
        ? healthStore.data.map((x) => (x.id === h.id ? h : x))
        : [...healthStore.data, h];
      healthStore.setData(next);
    },
    [healthStore],
  );
  const deleteHealthCheck = useCallback(
    (id: string) =>
      healthStore.setData(healthStore.data.filter((h) => h.id !== id)),
    [healthStore],
  );
  const toggleHealthCheck = useCallback(
    (id: string) =>
      healthStore.setData(
        healthStore.data.map((h) =>
          h.id === id ? { ...h, enabled: !h.enabled } : h,
        ),
      ),
    [healthStore],
  );
  const recordHealthCheck = useCallback(
    (id: string, status: "up" | "down", latencyMs: number) =>
      healthStore.setData(
        healthStore.data.map((h) =>
          h.id === id
            ? {
                ...h,
                lastChecked: new Date().toISOString(),
                lastStatus: status,
                lastLatencyMs: latencyMs,
              }
            : h,
        ),
      ),
    [healthStore],
  );

  /* ─── Localization actions ─── */
  const upsertLanguage = useCallback(
    (l: LocalizationLanguage) => {
      const exists = localizationStore.data.some((x) => x.id === l.id);
      let next: LocalizationLanguage[];
      if (exists) {
        next = localizationStore.data.map((x) => (x.id === l.id ? l : x));
      } else {
        next = [...localizationStore.data, l];
      }
      // Only one default at a time.
      if (l.isDefault) {
        next = next.map((x) =>
          x.id === l.id ? x : { ...x, isDefault: false },
        );
      }
      localizationStore.setData(next);
    },
    [localizationStore],
  );
  const deleteLanguage = useCallback(
    (id: string) =>
      localizationStore.setData(
        localizationStore.data.filter((l) => l.id !== id),
      ),
    [localizationStore],
  );
  const toggleLanguage = useCallback(
    (id: string) =>
      localizationStore.setData(
        localizationStore.data.map((l) =>
          l.id === id ? { ...l, active: !l.active } : l,
        ),
      ),
    [localizationStore],
  );
  const setDefaultLanguage = useCallback(
    (id: string) =>
      localizationStore.setData(
        localizationStore.data.map((l) => ({
          ...l,
          isDefault: l.id === id,
        })),
      ),
    [localizationStore],
  );

  /* ─── Secret access log actions ─── */
  const recordSecretAccess = useCallback(
    (entry: Omit<SecretAccessLogEntry, "id" | "timestamp">) =>
      secretAccessStore.setData(
        [
          {
            ...entry,
            id: uid(),
            timestamp: new Date().toISOString(),
          },
          ...secretAccessStore.data,
        ].slice(0, 1000),
      ),
    [secretAccessStore],
  );
  const clearSecretAccess = useCallback(
    () => secretAccessStore.setData([]),
    [secretAccessStore],
  );

  /* ─── Batch 2 actions ─── */

  /* Error Tracker */
  const recordError = useCallback(
    (
      entry: Omit<
        ErrorLogEntry,
        "id" | "firstSeen" | "lastSeen" | "count" | "fingerprint" | "resolved"
      >,
    ) => {
      const fingerprint = `${entry.source}:${entry.message.slice(0, 80)}`;
      const existing = errorTrackerStore.data.find(
        (e) => e.fingerprint === fingerprint,
      );
      const now = new Date().toISOString();
      if (existing) {
        errorTrackerStore.setData(
          errorTrackerStore.data.map((e) =>
            e.fingerprint === fingerprint
              ? { ...e, count: e.count + 1, lastSeen: now }
              : e,
          ),
        );
      } else {
        errorTrackerStore.setData(
          [
            {
              ...entry,
              id: uid(),
              fingerprint,
              count: 1,
              firstSeen: now,
              lastSeen: now,
              resolved: false,
            },
            ...errorTrackerStore.data,
          ].slice(0, 500),
        );
      }
    },
    [errorTrackerStore],
  );
  const resolveError = useCallback(
    (id: string) =>
      errorTrackerStore.setData(
        errorTrackerStore.data.map((e) =>
          e.id === id ? { ...e, resolved: !e.resolved } : e,
        ),
      ),
    [errorTrackerStore],
  );
  const clearResolvedErrors = useCallback(
    () =>
      errorTrackerStore.setData(
        errorTrackerStore.data.filter((e) => !e.resolved),
      ),
    [errorTrackerStore],
  );
  const clearAllErrors = useCallback(
    () => errorTrackerStore.setData([]),
    [errorTrackerStore],
  );

  /* Sessions */
  const upsertSession = useCallback(
    (s: UserSession) => {
      const exists = sessionsStore.data.some((x) => x.id === s.id);
      sessionsStore.setData(
        exists
          ? sessionsStore.data.map((x) => (x.id === s.id ? s : x))
          : [s, ...sessionsStore.data],
      );
    },
    [sessionsStore],
  );
  const revokeSession = useCallback(
    (id: string) =>
      sessionsStore.setData(
        sessionsStore.data.map((x) =>
          x.id === id ? { ...x, active: false } : x,
        ),
      ),
    [sessionsStore],
  );
  const revokeAllSessions = useCallback(
    () =>
      sessionsStore.setData(
        sessionsStore.data.map((x) => ({ ...x, active: false })),
      ),
    [sessionsStore],
  );

  /* Task Queue */
  const enqueueTask = useCallback(
    (
      task: Omit<
        TaskQueueItem,
        "id" | "createdAt" | "attempts" | "status" | "progress"
      >,
    ) => {
      const item: TaskQueueItem = {
        ...task,
        id: uid(),
        status: "queued",
        progress: 0,
        attempts: 0,
        createdAt: new Date().toISOString(),
      };
      taskQueueStore.setData([...taskQueueStore.data, item]);
      return item.id;
    },
    [taskQueueStore],
  );
  const updateTask = useCallback(
    (id: string, patch: Partial<TaskQueueItem>) =>
      taskQueueStore.setData(
        taskQueueStore.data.map((t) => (t.id === id ? { ...t, ...patch } : t)),
      ),
    [taskQueueStore],
  );
  const cancelTask = useCallback(
    (id: string) =>
      taskQueueStore.setData(
        taskQueueStore.data.map((t) =>
          t.id === id
            ? { ...t, status: "failed", error: "Cancelled by admin" }
            : t,
        ),
      ),
    [taskQueueStore],
  );
  const retryTask = useCallback(
    (id: string) =>
      taskQueueStore.setData(
        taskQueueStore.data.map((t) =>
          t.id === id
            ? {
                ...t,
                status: "queued",
                attempts: t.attempts + 1,
                error: undefined,
              }
            : t,
        ),
      ),
    [taskQueueStore],
  );
  const clearCompletedTasks = useCallback(
    () =>
      taskQueueStore.setData(
        taskQueueStore.data.filter((t) => t.status !== "completed"),
      ),
    [taskQueueStore],
  );

  /* Log Streams */
  const appendLog = useCallback(
    (entry: Omit<LogStreamEntry, "id" | "timestamp">) =>
      logStreamsStore.setData(
        [
          { ...entry, id: uid(), timestamp: new Date().toISOString() },
          ...logStreamsStore.data,
        ].slice(0, 1000),
      ),
    [logStreamsStore],
  );
  const clearLogs = useCallback(
    () => logStreamsStore.setData([]),
    [logStreamsStore],
  );

  /* Role Matrix */
  const updateRolePermission = useCallback(
    (id: string, patch: Partial<RolePermission>) =>
      roleMatrixStore.setData(
        roleMatrixStore.data.map((rp) =>
          rp.id === id
            ? { ...rp, ...patch, updatedAt: new Date().toISOString() }
            : rp,
        ),
      ),
    [roleMatrixStore],
  );
  const toggleRoleAction = useCallback(
    (id: string, action: PermissionAction) =>
      roleMatrixStore.setData(
        roleMatrixStore.data.map((rp) =>
          rp.id === id
            ? {
                ...rp,
                actions: rp.actions.includes(action)
                  ? rp.actions.filter((a) => a !== action)
                  : [...rp.actions, action],
                updatedAt: new Date().toISOString(),
              }
            : rp,
        ),
      ),
    [roleMatrixStore],
  );
  const resetRoleMatrix = useCallback(
    () => roleMatrixStore.setData(DEFAULT_ROLE_MATRIX),
    [roleMatrixStore],
  );

  /* Release Coordinator */
  const upsertRelease = useCallback(
    (r: ReleaseCoordinator) => {
      const exists = releaseCoordStore.data.some((x) => x.id === r.id);
      releaseCoordStore.setData(
        exists
          ? releaseCoordStore.data.map((x) =>
              x.id === r.id ? { ...r, updatedAt: new Date().toISOString() } : x,
            )
          : [...releaseCoordStore.data, r],
      );
    },
    [releaseCoordStore],
  );
  const promoteRelease = useCallback(
    (id: string, percent: number) =>
      releaseCoordStore.setData(
        releaseCoordStore.data.map((r) =>
          r.id === id
            ? {
                ...r,
                rolloutPercent: percent,
                status: percent >= 100 ? "live" : "rolling",
                promotedAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
              }
            : r,
        ),
      ),
    [releaseCoordStore],
  );
  const pauseRelease = useCallback(
    (id: string) =>
      releaseCoordStore.setData(
        releaseCoordStore.data.map((r) =>
          r.id === id
            ? { ...r, status: "paused", updatedAt: new Date().toISOString() }
            : r,
        ),
      ),
    [releaseCoordStore],
  );
  const rollbackRelease = useCallback(
    (id: string) =>
      releaseCoordStore.setData(
        releaseCoordStore.data.map((r) =>
          r.id === id
            ? {
                ...r,
                status: "rolled-back",
                rolloutPercent: 0,
                updatedAt: new Date().toISOString(),
              }
            : r,
        ),
      ),
    [releaseCoordStore],
  );
  const deleteRelease = useCallback(
    (id: string) =>
      releaseCoordStore.setData(
        releaseCoordStore.data.filter((r) => r.id !== id),
      ),
    [releaseCoordStore],
  );

  /* Migrations */
  const upsertMigration = useCallback(
    (m: MigrationRecord) => {
      const exists = migrationsStore.data.some((x) => x.id === m.id);
      migrationsStore.setData(
        exists
          ? migrationsStore.data.map((x) => (x.id === m.id ? m : x))
          : [...migrationsStore.data, m],
      );
    },
    [migrationsStore],
  );
  const markMigrationApplied = useCallback(
    (id: string) =>
      migrationsStore.setData(
        migrationsStore.data.map((m) =>
          m.id === id
            ? {
                ...m,
                status: "applied",
                appliedAt: new Date().toISOString(),
              }
            : m,
        ),
      ),
    [migrationsStore],
  );
  const rollbackMigration = useCallback(
    (id: string) =>
      migrationsStore.setData(
        migrationsStore.data.map((m) =>
          m.id === id ? { ...m, status: "rolled-back" } : m,
        ),
      ),
    [migrationsStore],
  );

  /* Webhook Deliveries */
  const recordDelivery = useCallback(
    (d: Omit<WebhookDelivery, "id" | "queuedAt">) =>
      webhookDeliveriesStore.setData(
        [
          { ...d, id: uid(), queuedAt: new Date().toISOString() },
          ...webhookDeliveriesStore.data,
        ].slice(0, 500),
      ),
    [webhookDeliveriesStore],
  );
  const retryDelivery = useCallback(
    (id: string) =>
      webhookDeliveriesStore.setData(
        webhookDeliveriesStore.data.map((d) =>
          d.id === id
            ? {
                ...d,
                status: "retrying" as DeliveryStatus,
                attempt: d.attempt + 1,
              }
            : d,
        ),
      ),
    [webhookDeliveriesStore],
  );
  const clearDeliveries = useCallback(
    () => webhookDeliveriesStore.setData([]),
    [webhookDeliveriesStore],
  );

  /* Storage Explorer */
  const upsertStorageItem = useCallback(
    (item: StorageBucketItem) => {
      const exists = storageExplorerStore.data.some((x) => x.id === item.id);
      storageExplorerStore.setData(
        exists
          ? storageExplorerStore.data.map((x) => (x.id === item.id ? item : x))
          : [...storageExplorerStore.data, item],
      );
    },
    [storageExplorerStore],
  );
  const deleteStorageItem = useCallback(
    (id: string) =>
      storageExplorerStore.setData(
        storageExplorerStore.data.filter((x) => x.id !== id),
      ),
    [storageExplorerStore],
  );

  /* API Rate Limits */
  const upsertRateLimit = useCallback(
    (entry: ApiRateLimitEntry) => {
      const exists = apiRateLimitsStore.data.some((x) => x.id === entry.id);
      apiRateLimitsStore.setData(
        exists
          ? apiRateLimitsStore.data.map((x) =>
              x.id === entry.id
                ? { ...entry, updatedAt: new Date().toISOString() }
                : x,
            )
          : [...apiRateLimitsStore.data, entry],
      );
    },
    [apiRateLimitsStore],
  );
  const toggleRateLimit = useCallback(
    (id: string) =>
      apiRateLimitsStore.setData(
        apiRateLimitsStore.data.map((x) =>
          x.id === id
            ? { ...x, enabled: !x.enabled, updatedAt: new Date().toISOString() }
            : x,
        ),
      ),
    [apiRateLimitsStore],
  );
  const deleteRateLimit = useCallback(
    (id: string) =>
      apiRateLimitsStore.setData(
        apiRateLimitsStore.data.filter((x) => x.id !== id),
      ),
    [apiRateLimitsStore],
  );
  const resetRateCounters = useCallback(
    () =>
      apiRateLimitsStore.setData(
        apiRateLimitsStore.data.map((x) => ({ ...x, currentCount: 0 })),
      ),
    [apiRateLimitsStore],
  );

  return {
    loading:
      webhooksStore.loading ||
      apikeysStore.loading ||
      announcementsStore.loading ||
      maintenanceStore.loading ||
      blocklistStore.loading ||
      corsStore.loading ||
      envvarsStore.loading ||
      jobsStore.loading ||
      experimentsStore.loading ||
      healthStore.loading ||
      localizationStore.loading ||
      secretAccessStore.loading ||
      errorTrackerStore.loading ||
      sessionsStore.loading ||
      taskQueueStore.loading ||
      logStreamsStore.loading ||
      roleMatrixStore.loading ||
      releaseCoordStore.loading ||
      migrationsStore.loading ||
      webhookDeliveriesStore.loading ||
      storageExplorerStore.loading ||
      apiRateLimitsStore.loading,
    /* webhooks */
    webhooks: webhooksStore.data,
    upsertWebhook,
    deleteWebhook,
    toggleWebhook,
    rotateWebhookSecret,
    recordWebhookTrigger,
    /* api keys */
    apiKeys: apikeysStore.data,
    upsertApiKey,
    deleteApiKey,
    toggleApiKey,
    rotateApiKey,
    recordApiKeyUsage,
    /* announcements */
    announcements: announcementsStore.data,
    upsertAnnouncement,
    deleteAnnouncement,
    toggleAnnouncement,
    recordDismiss,
    /* maintenance */
    maintenanceWindows: maintenanceStore.data,
    upsertMaintenance,
    deleteMaintenance,
    toggleMaintenance,
    /* blocklist */
    blocklist: blocklistStore.data,
    addBlocklist,
    deleteBlocklist,
    toggleBlocklist,
    bulkAddBlocklist,
    clearBlocklist,
    /* cors */
    corsOrigins: corsStore.data,
    upsertCors,
    deleteCors,
    /* env vars */
    envVars: envvarsStore.data,
    upsertEnvVar,
    deleteEnvVar,
    bulkImportEnvVars,
    /* jobs */
    jobs: jobsStore.data,
    toggleJob,
    runJobNow,
    finishJob,
    upsertJob,
    deleteJob,
    /* experiments */
    experiments: experimentsStore.data,
    upsertExperiment,
    deleteExperiment,
    setExperimentStatus,
    /* health checks */
    healthChecks: healthStore.data,
    upsertHealthCheck,
    deleteHealthCheck,
    toggleHealthCheck,
    recordHealthCheck,
    /* localization */
    languages: localizationStore.data,
    upsertLanguage,
    deleteLanguage,
    toggleLanguage,
    setDefaultLanguage,
    /* secret access log */
    secretAccessLog: secretAccessStore.data,
    recordSecretAccess,
    clearSecretAccess,
    /* error tracker */
    errorLog: errorTrackerStore.data,
    recordError,
    resolveError,
    clearResolvedErrors,
    clearAllErrors,
    /* sessions */
    sessions: sessionsStore.data,
    upsertSession,
    revokeSession,
    revokeAllSessions,
    /* task queue */
    taskQueue: taskQueueStore.data,
    enqueueTask,
    updateTask,
    cancelTask,
    retryTask,
    clearCompletedTasks,
    /* log streams */
    logStreams: logStreamsStore.data,
    appendLog,
    clearLogs,
    /* role matrix */
    roleMatrix: roleMatrixStore.data,
    updateRolePermission,
    toggleRoleAction,
    resetRoleMatrix,
    /* release coordinator */
    releases: releaseCoordStore.data,
    upsertRelease,
    promoteRelease,
    pauseRelease,
    rollbackRelease,
    deleteRelease,
    /* migrations */
    migrations: migrationsStore.data,
    upsertMigration,
    markMigrationApplied,
    rollbackMigration,
    /* webhook deliveries */
    webhookDeliveries: webhookDeliveriesStore.data,
    recordDelivery,
    retryDelivery,
    clearDeliveries,
    /* storage explorer */
    storageItems: storageExplorerStore.data,
    upsertStorageItem,
    deleteStorageItem,
    /* api rate limits */
    apiRateLimits: apiRateLimitsStore.data,
    upsertRateLimit,
    toggleRateLimit,
    deleteRateLimit,
    resetRateCounters,
    /* utility */
    uid,
    randomKey,
    maskValue,
    DEFAULT_WEBHOOK_EVENTS,
    DEFAULT_API_SCOPES,
    DEFAULT_CORS_METHODS,
    DEFAULT_ENV_CATEGORIES,
    DEFAULT_ROLES,
    DEFAULT_RESOURCES,
    DEFAULT_TASK_TYPES,
    DEFAULT_LOG_SOURCES,
  };
}

export type FounderAdvancedStore = ReturnType<typeof useFounderAdvancedStore>;
