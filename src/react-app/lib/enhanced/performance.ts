/**
 * Enhanced Performance Utilities for FuelPro
 * Advanced optimization, caching, and performance monitoring
 */

import { useEffect, useRef, useCallback, useMemo } from "react";
import * as React from "react";

// Performance monitoring constants
const PERFORMANCE_THRESHOLDS = {
  FCP: 1800, // First Contentful Paint
  LCP: 2500, // Largest Contentful Paint
  FID: 100, // First Input Delay
  CLS: 0.1, // Cumulative Layout Shift
};

export interface PerformanceMetrics {
  fcp?: number;
  lcp?: number;
  fid?: number;
  cls?: number;
  tti?: number;
  ttfb?: number;
  timestamp: string;
}

// Enhanced cache management with TTL support
class EnhancedCache<T> {
  private cache: Map<string, { data: T; expiry: number; hits: number }> =
    new Map();
  private defaultTTL: number;
  private maxSize: number;

  constructor(defaultTTL: number = 300000, maxSize: number = 1000) {
    this.defaultTTL = defaultTTL;
    this.maxSize = maxSize;
  }

  set(key: string, value: T, ttl?: number): void {
    // Evict oldest if at capacity
    if (this.cache.size >= this.maxSize && !this.cache.has(key)) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey) this.cache.delete(firstKey);
    }

    this.cache.set(key, {
      data: value,
      expiry: Date.now() + (ttl ?? this.defaultTTL),
      hits: 0,
    });
  }

  get(key: string): T | null {
    const item = this.cache.get(key);
    if (!item) return null;

    if (Date.now() > item.expiry) {
      this.cache.delete(key);
      return null;
    }

    item.hits++;
    return item.data;
  }

  has(key: string): boolean {
    const item = this.cache.get(key);
    if (!item) return false;

    if (Date.now() > item.expiry) {
      this.cache.delete(key);
      return false;
    }

    return true;
  }

  delete(key: string): boolean {
    return this.cache.delete(key);
  }

  clear(): void {
    this.cache.clear();
  }

  getStats(): { size: number; keys: string[] } {
    const now = Date.now();
    const validKeys: string[] = [];

    this.cache.forEach((_, key) => {
      const item = this.cache.get(key);
      if (item && now <= item.expiry) {
        validKeys.push(key);
      } else {
        this.cache.delete(key);
      }
    });

    return {
      size: validKeys.length,
      keys: validKeys,
    };
  }

  prune(): number {
    const now = Date.now();
    let pruned = 0;

    this.cache.forEach((item, key) => {
      if (now > item.expiry) {
        this.cache.delete(key);
        pruned++;
      }
    });

    return pruned;
  }
}

// Global cache instances for different use cases
export const dataCache = new EnhancedCache<any>(300000, 500); // 5 min default
export const uiCache = new EnhancedCache<any>(60000, 200); // 1 min for UI state
export const apiCache = new EnhancedCache<any>(120000, 1000); // 2 min for API responses

// Performance observer hook
export function usePerformanceMonitor(
  callback?: (metrics: PerformanceMetrics) => void,
) {
  const metricsRef = useRef<PerformanceMetrics>({
    timestamp: new Date().toISOString(),
  });
  const observerRef = useRef<PerformanceObserver | null>(null);

  useEffect(() => {
    // Monitor LCP
    const lcpObserver = new PerformanceObserver((entryList) => {
      const entries = entryList.getEntries();
      const lastEntry = entries[entries.length - 1];
      const lcp = lastEntry?.startTime;

      if (lcp) {
        metricsRef.current.lcp = lcp;
        callback?.(metricsRef.current);
      }
    });

    try {
      lcpObserver.observe({ entryTypes: ["largest-contentful-paint"] });
    } catch (e) {
      console.warn("LCP observer not supported");
    }

    // Monitor CLS
    let clsValue = 0;
    const clsObserver = new PerformanceObserver((entryList) => {
      for (const entry of entryList.getEntries()) {
        if (!(entry as any).hadRecentInput) {
          clsValue += (entry as any).value;
        }
      }
      metricsRef.current.cls = clsValue;
      callback?.(metricsRef.current);
    });

    try {
      clsObserver.observe({ entryTypes: ["layout-shift"] });
    } catch (e) {
      console.warn("CLS observer not supported");
    }

    // Monitor FCP
    const fcpObserver = new PerformanceObserver((entryList) => {
      const entries = entryList.getEntries();
      const fcp = entries.find(
        (e) => e.name === "first-contentful-paint",
      )?.startTime;

      if (fcp) {
        metricsRef.current.fcp = fcp;
        callback?.(metricsRef.current);
      }
    });

    try {
      fcpObserver.observe({ entryTypes: ["paint"] });
    } catch (e) {
      console.warn("FCP observer not supported");
    }

    observerRef.current = lcpObserver;

    return () => {
      lcpObserver.disconnect();
      clsObserver.disconnect();
      fcpObserver.disconnect();
    };
  }, [callback]);

  return metricsRef.current;
}

// Debounce with immediate option
export function useDebounce<T>(
  value: T,
  delay: number,
  immediate?: boolean,
): T {
  const [debouncedValue, setDebouncedValue] = React.useState<T>(value);

  useEffect(() => {
    if (immediate && !debouncedValue) {
      setDebouncedValue(value);
      return;
    }

    const handler = setTimeout(() => {
      setDebouncedValue(value);
    }, delay);

    return () => clearTimeout(handler);
  }, [value, delay, immediate, debouncedValue]);

  return debouncedValue;
}

// Throttle hook
export function useThrottle<T>(value: T, interval: number): T {
  const [throttledValue, setThrottledValue] = React.useState<T>(value);
  const lastUpdated = useRef<number>(0);

  useEffect(() => {
    const now = Date.now();
    if (now - lastUpdated.current >= interval) {
      setThrottledValue(value);
      lastUpdated.current = now;
    } else {
      const handler = setTimeout(
        () => {
          setThrottledValue(value);
          lastUpdated.current = Date.now();
        },
        interval - (now - lastUpdated.current),
      );

      return () => clearTimeout(handler);
    }
  }, [value, interval]);

  return throttledValue;
}

// Memory-efficient list virtualization helper
export function useVirtualList<T>(
  items: T[],
  containerHeight: number,
  itemHeight: number,
) {
  const [scrollTop, setScrollTop] = React.useState(0);

  const visibleCount = Math.ceil(containerHeight / itemHeight) + 5;
  const startIndex = Math.floor(scrollTop / itemHeight);
  const endIndex = Math.min(startIndex + visibleCount, items.length);

  const visibleItems = useMemo(() => {
    return items.slice(startIndex, endIndex);
  }, [items, startIndex, endIndex]);

  const totalHeight = items.length * itemHeight;
  const offsetY = startIndex * itemHeight;

  const onScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    setScrollTop(e.currentTarget.scrollTop);
  }, []);

  return {
    visibleItems,
    totalHeight,
    offsetY,
    onScroll,
    startIndex,
    endIndex,
  };
}

// Intersection Observer hook for lazy loading
export function useIntersectionObserver<T extends Element>(
  options: IntersectionObserverInit = { threshold: 0.1, rootMargin: "100px" },
) {
  const [isIntersecting, setIsIntersecting] = React.useState(false);
  const elementRef = React.useRef<T | null>(null);

  useEffect(() => {
    const observer = new IntersectionObserver(([entry]) => {
      setIsIntersecting(entry.isIntersecting);
    }, options);

    if (elementRef.current) {
      observer.observe(elementRef.current);
    }

    return () => observer.disconnect();
  }, [options]);

  return { elementRef, isIntersecting };
}

// Request idle callback wrapper
export function scheduleIdleTask(
  callback: (deadline: IdleDeadline) => void,
  timeout?: number,
) {
  if ("requestIdleCallback" in window) {
    return (window as any).requestIdleCallback(callback, { timeout });
  } else {
    return setTimeout(
      () =>
        callback({
          timeRemaining: () => 0,
          didTimeout: true,
        }),
      1,
    );
  }
}

// Web Worker pool for heavy computations
class WorkerPool {
  private workers: Worker[] = [];
  private queue: Array<{
    task: any;
    resolve: (value: unknown) => void;
    reject: (reason?: unknown) => void;
  }> = [];
  private availableWorkers: number[] = [];

  constructor(workerFactory: () => Worker, poolSize: number = 4) {
    for (let i = 0; i < poolSize; i++) {
      const worker = workerFactory();
      worker.onmessage = (e) => this.handleWorkerMessage(i, e);
      worker.onerror = (e) => this.handleWorkerError(i, e);
      this.workers.push(worker);
      this.availableWorkers.push(i);
    }
  }

  private handleWorkerMessage(workerIndex: number, event: MessageEvent) {
    const task = this.queue.shift();
    if (task) {
      task.resolve(event.data);
      this.availableWorkers.push(workerIndex);
      this.processQueue();
    } else {
      this.availableWorkers.push(workerIndex);
    }
  }

  private handleWorkerError(workerIndex: number, error: ErrorEvent) {
    console.error(`Worker ${workerIndex} error:`, error);
    this.availableWorkers.push(workerIndex);
  }

  private processQueue() {
    while (this.queue.length > 0 && this.availableWorkers.length > 0) {
      const workerIndex = this.availableWorkers.pop()!;
      const task = this.queue.shift()!;
      this.workers[workerIndex].postMessage(task.task);
    }
  }

  async runTask<T>(task: any): Promise<T> {
    return new Promise((resolve, reject) => {
      if (this.availableWorkers.length > 0) {
        const workerIndex = this.availableWorkers.pop()!;
        this.workers[workerIndex].postMessage(task);
        // Will be resolved in handleWorkerMessage
      } else {
        this.queue.push({ task, resolve, reject });
      }
    });
  }

  terminate() {
    this.workers.forEach((worker) => worker.terminate());
  }
}

// Export for use in components
export { WorkerPool };
export default EnhancedCache;
