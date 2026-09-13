/**
 * Single authoritative loader for pdfjs-dist.
 *
 * Uses the LEGACY build (`pdfjs-dist/legacy/build/pdf.mjs`), which is
 * Babel+core-js-compiled and bundles shims for `Promise.withResolvers`,
 * `URL.parse`, etc. The modern `build/pdf.mjs` relies on those
 * "Baseline 2024" APIs (Safari 17.4+/18+, Android WebView <126), so M-PESA
 * statement / compliance / payslip PDF parsing silently fails on many mobile
 * phones while working on laptops. The legacy build works everywhere.
 *
 * The worker is the legacy worker served same-origin (CSP `worker-src 'self'`
 * compliant). If `Worker` cannot be used at all, pdfjs falls back to its
 * built-in main-thread fake worker via `disableWorker: true`.
 */
import legacyWorkerUrl from "pdfjs-dist/legacy/build/pdf.worker.min.mjs?url";

export const pdfWorkerUrl = legacyWorkerUrl;

export interface PdfJsModule {
  GlobalWorkerOptions: { workerSrc: string };
  getDocument: (src: {
    data?: ArrayBuffer | Uint8Array;
    url?: string;
    disableWorker?: boolean;
    isEvalSupported?: boolean;
  }) => { promise: Promise<PdfDocumentProxy> };
}

export interface PdfPageProxy {
  getTextContent(): Promise<{ items: Array<{ str?: string }> }>;
  getViewport(params: { scale: number }): any;
  render(params: { canvasContext: CanvasRenderingContext2D; viewport: any }): {
    promise: Promise<void>;
  };
}

export interface PdfDocumentProxy {
  numPages: number;
  getPage(pageNum: number): Promise<PdfPageProxy>;
}

/**
 * Detect whether the current engine is too old to even load the legacy
 * worker reliably. Modern mobile engines (iOS 15+, Android 8+) all pass;
 * this is a defensive probe only.
 */
export function isWorkerUsable(): boolean {
  try {
    return typeof Worker === "function";
  } catch {
    return false;
  }
}

let pdfjsPromise: Promise<PdfJsModule> | null = null;

/**
 * Lazily import the LEGACY pdfjs module and configure its worker once.
 */
export async function loadPdfJs(): Promise<PdfJsModule> {
  if (!pdfjsPromise) {
    pdfjsPromise = (async () => {
      const mod =
        (await import("pdfjs-dist/legacy/build/pdf.mjs")) as unknown as PdfJsModule;
      mod.GlobalWorkerOptions.workerSrc = legacyWorkerUrl;
      return mod;
    })();
    // A failed import must not poison the singleton forever.
    pdfjsPromise.catch(() => {
      pdfjsPromise = null;
    });
  }
  return pdfjsPromise;
}

/**
 * Open a PDF document from bytes through the legacy build, wiring the
 * same-origin worker (or the main-thread fallback when Web Worker is
 * unavailable — e.g. some locked-down Android WebViews).
 */
export async function loadPdfDocument(
  data: ArrayBuffer | Uint8Array,
): Promise<PdfDocumentProxy> {
  const pdfjs = await loadPdfJs();
  const task = pdfjs.getDocument({
    data,
    disableWorker: !isWorkerUsable(),
    isEvalSupported: false,
  });
  return task.promise;
}
