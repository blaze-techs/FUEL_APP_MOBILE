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
    password?: string;
    onPassword?: (fn: (pw: string) => void, reason: number) => void;
  }) => { promise: Promise<PdfDocumentProxy>; destroy: () => Promise<void> };
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
 *
 * `password` is optional: when provided, pdfjs uses it to decrypt a
 * password-protected PDF silently (no onPassword prompt). This is what the
 * silent unlocker (pdf-unlock.ts) uses to open owner-restricted / short-PIN
 * locked PDFs on any device.
 */
export async function loadPdfDocument(
  data: ArrayBuffer | Uint8Array,
  password?: string,
): Promise<PdfDocumentProxy> {
  const pdfjs = await loadPdfJs();
  // Try the dedicated worker first (the fast, pdfjs-recommended path). Some
  // mobile engines (Android/Capacitor WebView, locked-down CSP, blob-URL
  // restrictions) fail to start the worker even though `Worker` exists — the
  // getDocument promise rejects with a worker-setup error, so we transparently
  // retry with the main-thread fake worker. The fake worker imports the same
  // module on the main thread, which is immune to Worker URL/MIME/CSP quirks.
  try {
    const task = pdfjs.getDocument({
      data,
      password,
      disableWorker: false,
      isEvalSupported: false,
    });
    return await task.promise;
  } catch (firstErr: any) {
    const msg = `${firstErr?.message || firstErr || ""}`;
    if (/worker|fake worker|setting up/i.test(msg)) {
      try {
        const task = pdfjs.getDocument({
          data,
          password,
          disableWorker: true,
          isEvalSupported: false,
        });
        return await task.promise;
      } catch {
        // Surface the ORIGINAL error — it is the more truthful one.
        throw firstErr;
      }
    }
    throw firstErr;
  }
}

/**
 * Open a PDF with a single automatic unlock attempt using a candidate
 * password; returns the document proxy when it opens. Used by callers that
 * already know (or guessed) a candidate and want a no-fuss open.
 */
export async function tryOpenWithPassword(
  data: ArrayBuffer | Uint8Array,
  password: string,
): Promise<PdfDocumentProxy | null> {
  try {
    return await loadPdfDocument(data, password);
  } catch {
    return null;
  }
}
