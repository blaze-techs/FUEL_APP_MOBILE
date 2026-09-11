/**
 * CENTRALIZED LOGGING UTILITY
 *
 * Provides consistent logging with levels, namespaces, and production controls.
 */

// Log levels
export const LOG_LEVELS = {
  DEBUG: 0,
  INFO: 1,
  WARN: 2,
  ERROR: 3,
  NONE: 4,
} as const;

export type LogLevel = (typeof LOG_LEVELS)[keyof typeof LOG_LEVELS];

// Current log level (can be changed)
let currentLevel: LogLevel = LOG_LEVELS.DEBUG;

// Development mode check
const isDevelopment = import.meta.env.DEV;
const isProduction = !isDevelopment;

// ============================================
// LOGGER CLASS
// ============================================

class Logger {
  private namespace: string;

  constructor(namespace: string) {
    this.namespace = namespace;
  }

  /**
   * Create a child logger with a sub-namespace
   */
  child(subNamespace: string): Logger {
    return new Logger(`${this.namespace}:${subNamespace}`);
  }

  /**
   * Format log message with namespace and timestamp
   */
  private formatMessage(message: string): string {
    const timestamp = new Date().toISOString();
    return `[${timestamp}] [${this.namespace}] ${message}`;
  }

  /**
   * Debug level - detailed information for debugging
   */
  debug(message: string, ...args: unknown[]): void {
    if (currentLevel <= LOG_LEVELS.DEBUG) {
      console.debug(this.formatMessage(message), ...args);
    }
  }

  /**
   * Info level - general information
   */
  info(message: string, ...args: unknown[]): void {
    if (currentLevel <= LOG_LEVELS.INFO) {
      console.info(this.formatMessage(message), ...args);
    }
  }

  /**
   * Warn level - warning messages
   */
  warn(message: string, ...args: unknown[]): void {
    if (currentLevel <= LOG_LEVELS.WARN) {
      console.warn(this.formatMessage(message), ...args);
    }
  }

  /**
   * Error level - error messages
   */
  error(message: string, ...args: unknown[]): void {
    if (currentLevel <= LOG_LEVELS.ERROR) {
      console.error(this.formatMessage(message), ...args);
    }
  }

  /**
   * Log with custom level
   */
  log(level: LogLevel, message: string, ...args: unknown[]): void {
    const methods: ((...args: unknown[]) => void)[] = [
      console.debug,
      console.info,
      console.warn,
      console.error,
    ];
    const fn = methods[level] ?? console.log;
    if (currentLevel <= level) {
      fn(this.formatMessage(message), ...args);
    }
  }
}

// ============================================
// LOGGER FACTORY
// ============================================

/**
 * Create a logger with a namespace
 */
export function createLogger(namespace: string): Logger {
  return new Logger(namespace);
}

// Pre-configured loggers for common namespaces
export const loggers = {
  // Core app
  app: createLogger("app"),
  auth: createLogger("auth"),
  station: createLogger("station"),

  // Data
  fuel: createLogger("fuel"),
  price: createLogger("price"),
  sales: createLogger("sales"),
  inventory: createLogger("inventory"),

  // Sync
  sync: createLogger("sync"),
  cloud: createLogger("cloud"),
  api: createLogger("api"),

  // UI
  ui: createLogger("ui"),
  theme: createLogger("theme"),
  tab: createLogger("tab"),

  // Integration
  mpesa: createLogger("mpesa"),
  printer: createLogger("printer"),
  storage: createLogger("storage"),

  // Utils
  currency: createLogger("currency"),
  format: createLogger("format"),
  date: createLogger("date"),

  // General
  default: createLogger("app"),
};

// ============================================
// GLOBAL CONFIGURATION
// ============================================

/**
 * Set the global log level
 */
export function setLogLevel(level: LogLevel): void {
  currentLevel = level;
}

/**
 * Get the current log level
 */
export function getLogLevel(): LogLevel {
  return currentLevel;
}

/**
 * Enable all logs (development mode)
 */
export function enableAllLogs(): void {
  setLogLevel(LOG_LEVELS.DEBUG);
}

/**
 * Disable all logs (production mode)
 */
export function disableAllLogs(): void {
  setLogLevel(LOG_LEVELS.NONE);
}

/**
 * Production-ready logging - minimal logs in production
 */
export function configureProductionLogging(): void {
  if (isProduction) {
    setLogLevel(LOG_LEVELS.WARN); // Only warnings and errors in production
  } else {
    setLogLevel(LOG_LEVELS.DEBUG); // Full logs in development
  }
}

// Auto-configure on import
configureProductionLogging();

// ============================================
// CONVENIENCE EXPORTS
// ============================================

export const log = loggers.default;
export { log as logger };

// Default export
export default log;
