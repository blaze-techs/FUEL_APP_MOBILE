// ============================================================
// PERFORMANCE UTILITIES - Debounce, Throttle, Lazy Load, RAF
// Targets: LCP < 1.5s, INP < 100ms, CLS < 0.05
// ============================================================

/** Debounce: delay execution until ms after last call */
export function debounce<T extends (...args: any[]) => void>(
  fn: T,
  ms: number,
): T {
  let timer: ReturnType<typeof setTimeout>;
  return ((...args: any[]) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  }) as T;
}

/** Throttle: execute at most once per ms */
export function throttle<T extends (...args: any[]) => void>(
  fn: T,
  ms: number,
): T {
  let last = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  return ((...args: any[]) => {
    const now = Date.now();
    if (now - last >= ms) {
      last = now;
      fn(...args);
    } else if (!timer) {
      timer = setTimeout(
        () => {
          last = Date.now();
          timer = null;
          fn(...args);
        },
        ms - (now - last),
      );
    }
  }) as T;
}

/** RAF-based throttle for scroll/resize handlers */
export function rafThrottle<T extends (...args: any[]) => void>(fn: T): T {
  let rafId: number | null = null;
  return ((...args: any[]) => {
    if (rafId !== null) return;
    rafId = requestAnimationFrame(() => {
      rafId = null;
      fn(...args);
    });
  }) as T;
}

/** Measure function execution time */
export function measurePerformance<T extends (...args: any[]) => any>(
  fn: T,
  label: string,
): T {
  return ((...args: any[]) => {
    const start = performance.now();
    const result = fn(...args);
    const duration = performance.now() - start;
    if (duration > 16) {
      console.warn(
        `[Performance] ${label} took ${duration.toFixed(1)}ms (>16ms frame budget)`,
      );
    }
    return result;
  }) as T;
}

/** Batch DOM reads to avoid layout thrashing */
export function batchReads<T>(reads: (() => T)[]): T[] {
  return reads.map((r) => r());
}

/** Batch DOM writes using requestAnimationFrame */
export function batchWrites(writes: (() => void)[]) {
  requestAnimationFrame(() => {
    writes.forEach((w) => w());
  });
}

/** Lazy load a component with intersection observer */
export function lazyLoadElement(
  el: HTMLElement,
  callback: () => void,
  options?: IntersectionObserverInit,
) {
  if ("IntersectionObserver" in window) {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            callback();
            observer.unobserve(el);
          }
        });
      },
      { rootMargin: "200px", ...options },
    );
    observer.observe(el);
  } else {
    callback(); // Fallback
  }
}

/** Preload critical resources */
export function preloadResource(
  href: string,
  as: "script" | "style" | "font" | "image",
) {
  const link = document.createElement("link");
  link.rel = as === "font" ? "preload" : "preload";
  link.href = href;
  link.as = as;
  if (as === "font") link.crossOrigin = "anonymous";
  document.head.appendChild(link);
}

/** Report Core Web Vitals */
export interface WebVitals {
  lcp?: number; // Largest Contentful Paint
  fid?: number; // First Input Delay
  cls?: number; // Cumulative Layout Shift
  inp?: number; // Interaction to Next Paint
  ttfb?: number; // Time to First Byte
  fcp?: number; // First Contentful Paint
}

const vitalsSnapshot: WebVitals = {};

export function getVitalsSnapshot(): WebVitals {
  return { ...vitalsSnapshot };
}

export function initVitalsTracking(callback?: (v: WebVitals) => void) {
  // FCP
  new PerformanceObserver((list) => {
    const entry = list.getEntries()[0] as PerformanceEntry;
    vitalsSnapshot.fcp = entry.startTime;
    callback?.({ ...vitalsSnapshot });
  }).observe({ type: "paint", buffered: true });

  // LCP
  new PerformanceObserver((list) => {
    const entries = list.getEntries();
    const last = entries[entries.length - 1] as PerformanceEntry;
    vitalsSnapshot.lcp = last.startTime;
    callback?.({ ...vitalsSnapshot });
  }).observe({ type: "largest-contentful-paint", buffered: true });

  // CLS
  let clsValue = 0;
  new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) {
      if (!(entry as any).hadRecentInput) {
        clsValue += (entry as any).value;
      }
    }
    vitalsSnapshot.cls = clsValue;
    callback?.({ ...vitalsSnapshot });
  }).observe({ type: "layout-shift", buffered: true });

  // TTFB
  const nav = performance.getEntriesByType(
    "navigation",
  )[0] as PerformanceNavigationTiming;
  if (nav) {
    vitalsSnapshot.ttfb = nav.responseStart;
  }

  // INP (using Event Timing API)
  if ("PerformanceEventTiming" in window) {
    let maxInp = 0;
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if ((entry as any).interactionId && entry.duration > maxInp) {
          maxInp = entry.duration;
          vitalsSnapshot.inp = maxInp;
        }
      }
      callback?.({ ...vitalsSnapshot });
    }).observe({ type: "event", buffered: true } as PerformanceObserverInit);
  }
}

/** Check if performance targets are met */
export function checkPerformanceTargets(
  vitals: WebVitals,
): { metric: string; value: number; target: number; pass: boolean }[] {
  return [
    {
      metric: "LCP",
      value: vitals.lcp ?? 0,
      target: 1500,
      pass: (vitals.lcp ?? Infinity) < 1500,
    },
    {
      metric: "INP",
      value: vitals.inp ?? 0,
      target: 100,
      pass: (vitals.inp ?? Infinity) < 100,
    },
    {
      metric: "CLS",
      value: vitals.cls ?? 0,
      target: 0.05,
      pass: (vitals.cls ?? Infinity) < 0.05,
    },
    {
      metric: "TTFB",
      value: vitals.ttfb ?? 0,
      target: 200,
      pass: (vitals.ttfb ?? Infinity) < 200,
    },
    {
      metric: "FCP",
      value: vitals.fcp ?? 0,
      target: 1000,
      pass: (vitals.fcp ?? Infinity) < 1000,
    },
  ];
}

/** Memory usage snapshot */
export function getMemoryUsage(): {
  used: number;
  total: number;
  limit: number;
} | null {
  const perf = performance as any;
  if (perf.memory) {
    return {
      used: Math.round(perf.memory.usedJSHeapSize / 1048576),
      total: Math.round(perf.memory.totalJSHeapSize / 1048576),
      limit: Math.round(perf.memory.jsHeapSizeLimit / 1048576),
    };
  }
  return null;
}

/** Cache API helpers for Service Worker communication */
export const CacheAPI = {
  async put(key: string, data: any) {
    const cache = await caches.open("fuelpro-v1");
    await cache.put(
      key,
      new Response(JSON.stringify(data), {
        headers: { "Content-Type": "application/json" },
      }),
    );
  },
  async get(key: string): Promise<any | null> {
    const cache = await caches.open("fuelpro-v1");
    const res = await cache.match(key);
    if (res) return res.json();
    return null;
  },
  async delete(key: string) {
    const cache = await caches.open("fuelpro-v1");
    await cache.delete(key);
  },
  async clear() {
    await caches.delete("fuelpro-v1");
  },
};
