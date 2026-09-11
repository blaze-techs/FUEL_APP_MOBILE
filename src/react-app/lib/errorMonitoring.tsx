/**
 * FuelPro Error Monitoring & Analytics
 *
 * Integrates Sentry for real-time error tracking
 * and privacy-friendly analytics (Plausible-style)
 */

// Sentry Configuration
const SENTRY_DSN = import.meta.env.VITE_SENTRY_DSN || "";

interface ErrorBoundaryProps {
  children: React.ReactNode;
  fallback?: React.ReactNode;
  onError?: (error: Error, errorInfo: React.ErrorInfo) => void;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

// Global Error Handler
export function initErrorMonitoring() {
  if (!SENTRY_DSN) {
    console.log("[FuelPro] Sentry not configured - error monitoring disabled");
    return;
  }

  // Dynamic import Sentry
  import("@sentry/react")
    .then((Sentry) => {
      Sentry.init({
        dsn: SENTRY_DSN,
        integrations: (integrations: any[]) => {
          return integrations.filter(
            (i) => !["BrowserTracing"].includes(i.name),
          );
        },
        tracesSampleRate: 0.1,
        replaysSessionSampleRate: 0.1,
        replaysOnErrorSampleRate: 1.0,
        environment: import.meta.env.MODE,
        release: "fuelpro@1.0.0",
        beforeSend(event) {
          // Filter out non-actionable errors
          if (
            event.exception?.values?.some(
              (e: any) =>
                e.type === "ResizeObserver loop" ||
                e.type === "Non-Error promise rejection",
            )
          ) {
            return null;
          }
          return event;
        },
      });
    })
    .catch(() => {
      console.log("[FuelPro] Failed to load Sentry");
    });
}

// Error Boundary Component
export class ErrorBoundary extends React.Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error("[FuelPro Error]", error, errorInfo);
    this.props.onError?.(error, errorInfo);

    // Report to Sentry
    if (SENTRY_DSN) {
      import("@sentry/react")
        .then((Sentry) => {
          Sentry.captureException(error, { extra: errorInfo as any });
        })
        .catch((err) =>
          console.warn("[ErrorMonitoring] Failed to load Sentry:", err),
        );
    }
  }

  render() {
    if (this.state.hasError) {
      return (
        this.props.fallback || (
          <div
            style={{
              minHeight: "100vh",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              background: "#0a0a0f",
              color: "#fff",
              padding: 20,
            }}
          >
            <div style={{ textAlign: "center", maxWidth: 400 }}>
              <div
                style={{
                  fontSize: 64,
                  marginBottom: 16,
                  color: "#ef4444",
                }}
              >
                ⚠️
              </div>
              <h1 style={{ fontSize: 24, marginBottom: 12 }}>
                Something went wrong
              </h1>
              <p style={{ color: "#9ca3af", marginBottom: 24 }}>
                We're sorry for the inconvenience. Please refresh the page or
                contact support.
              </p>
              <button
                onClick={() => window.location.reload()}
                style={{
                  padding: "12px 24px",
                  background: "#f59e0b",
                  color: "#000",
                  border: "none",
                  borderRadius: 8,
                  fontSize: 14,
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                Refresh Page
              </button>
            </div>
          </div>
        )
      );
    }
    return this.props.children;
  }
}

// Simple Analytics (Privacy-friendly)
export const analytics = {
  // Track page views
  page(path: string, title?: string) {
    if (import.meta.env.VITE_ANALYTICS_ENABLED !== "true") return;

    // Send to analytics endpoint (GDPR compliant)
    fetch("/api/analytics", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "pageview",
        path,
        title,
        timestamp: Date.now(),
        referrer: document.referrer,
      }),
    }).catch((err) =>
      console.warn("[ErrorMonitoring] async report failed:", err),
    );

    // Also log in development
    if (import.meta.env.DEV) {
      console.log("[Analytics] Page:", path, title);
    }
  },

  // Track events
  event(name: string, properties?: Record<string, any>) {
    if (import.meta.env.VITE_ANALYTICS_ENABLED !== "true") return;

    fetch("/api/analytics", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "event",
        name,
        properties,
        timestamp: Date.now(),
      }),
    }).catch((err) =>
      console.warn("[ErrorMonitoring] async report failed:", err),
    );

    if (import.meta.env.DEV) {
      console.log("[Analytics] Event:", name, properties);
    }
  },

  // Track errors
  error(message: string, stack?: string) {
    fetch("/api/analytics", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "error",
        message,
        stack,
        timestamp: Date.now(),
      }),
    }).catch((err) =>
      console.warn("[ErrorMonitoring] async report failed:", err),
    );
  },
};

// Performance monitoring
export const perfMonitor = {
  mark(name: string) {
    if (typeof window !== "undefined" && window.performance) {
      window.performance.mark(name);
    }
  },

  measure(name: string, startMark: string, endMark?: string) {
    if (typeof window !== "undefined" && window.performance) {
      if (endMark) {
        window.performance.measure(name, startMark, endMark);
      } else {
        window.performance.measure(name, startMark);
      }
    }
  },

  getMetrics() {
    if (typeof window === "undefined" || !window.performance) return null;

    const entries = window.performance.getEntriesByType(
      "navigation",
    )[0] as PerformanceNavigationTiming;
    if (!entries) return null;

    return {
      dns: entries.domainLookupEnd - entries.domainLookupStart,
      tcp: entries.connectEnd - entries.connectStart,
      ttfb: entries.responseStart - entries.requestStart,
      download: entries.responseEnd - entries.responseStart,
      domInteractive: entries.domInteractive,
      domComplete: entries.domComplete,
      total: entries.loadEventEnd - entries.startTime,
    };
  },
};

// React hook for analytics
export function useAnalytics() {
  return { analytics, perfMonitor };
}

import React from "react";
