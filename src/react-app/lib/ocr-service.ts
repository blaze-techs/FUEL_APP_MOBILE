/**
 * Shared on-device OCR service (tesseract.js) used by every upload/scan
 * flow in the app: Compliance documents, Sales Tracking sheet scans,
 * M-PESA statement scans, Document Converter, and Payroll sheet scans.
 *
 * ALL assets are served same-origin from /tessdata (CSP-safe, no external
 * calls, no API keys). The worker is a lazy singleton so the ~12MB engine
 * downloads once (then IndexedDB-cached) and is reused across components.
 *
 * Never import-and-call at module scope in tests — jsdom has no canvas/WASM.
 */
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

const TESS_ASSETS = "/tessdata";

export interface OcrProgress {
  /** 0..1 progress within the current stage. */
  progress: number;
  /** Human-readable stage for spinners. */
  stage: "loading-engine" | "rendering" | "recognizing";
}

interface OcrWorker {
  recognize: (
    image: Blob | HTMLCanvasElement,
  ) => Promise<{ data: { text: string } }>;
  terminate: () => Promise<void>;
}

let workerPromise: Promise<OcrWorker> | null = null;
/** Forwarded to by the singleton's logger so each caller gets progress. */
let progressSink: ((p: number) => void) | undefined;

async function getOcrWorker(): Promise<OcrWorker> {
  if (!workerPromise) {
    workerPromise = (async () => {
      const { createWorker } = await import("tesseract.js");
      const worker = await createWorker("eng", 1 /* OEM.LSTM_ONLY */, {
        workerPath: `${TESS_ASSETS}/worker.min.js`,
        corePath: TESS_ASSETS,
        langPath: TESS_ASSETS,
        gzip: true,
        cacheMethod: "write", // IndexedDB → subsequent runs skip the download
        logger: (m: { status?: string; progress?: number }) => {
          if (
            m?.status === "recognizing text" &&
            typeof m.progress === "number"
          )
            progressSink?.(m.progress);
        },
        errorHandler: () => {},
      });
      return worker as unknown as OcrWorker;
    })();
    // A failed creation must not poison the singleton forever.
    workerPromise.catch(() => {
      workerPromise = null;
    });
  }
  return workerPromise;
}

/** Render up to `maxPages` of a PDF to white-backed canvases (for OCR). */
export async function renderPdfPagesForOcr(
  file: File | Blob,
  maxPages = 2,
  scale = 2.5,
): Promise<HTMLCanvasElement[]> {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
  const buf = new Uint8Array(await file.arrayBuffer());
  const pdf = await pdfjs.getDocument({ data: buf }).promise;
  const pages: HTMLCanvasElement[] = [];
  const count = Math.min(pdf.numPages, maxPages);
  for (let p = 1; p <= count; p++) {
    const page = await pdf.getPage(p);
    // ~200dpi is the OCR sweet spot for A4 scans.
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    const ctx = canvas.getContext("2d");
    if (!ctx) break;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport }).promise;
    pages.push(canvas);
  }
  return pages;
}

/**
 * OCR a single image (Blob/File/canvas). Returns recognized text
 * ("" on failure — never throws).
 */
export async function ocrImage(
  image: Blob | HTMLCanvasElement,
  onProgress?: (p: OcrProgress) => void,
): Promise<string> {
  try {
    progressSink = (p) => onProgress?.({ progress: p, stage: "recognizing" });
    const worker = await getOcrWorker();
    const { data } = await worker.recognize(image);
    return data.text || "";
  } catch {
    return "";
  } finally {
    progressSink = undefined;
  }
}

/**
 * Visually analyze a scanned PDF: renders pages to canvas and OCRs them.
 * Returns the recognized text ("" on failure — never throws).
 */
export async function ocrPdf(
  file: File | Blob,
  opts: {
    maxPages?: number;
    onProgress?: (p: OcrProgress) => void;
  } = {},
): Promise<string> {
  const { maxPages = 2, onProgress } = opts;
  try {
    onProgress?.({ progress: 0, stage: "rendering" });
    const pages = await renderPdfPagesForOcr(file, maxPages);
    if (!pages.length) return "";
    let text = "";
    for (let i = 0; i < pages.length; i++) {
      const pageText = await ocrImage(pages[i], (p) =>
        onProgress?.({
          progress: (i + p.progress) / pages.length,
          stage: "recognizing",
        }),
      );
      text += pageText + "\n";
    }
    return text;
  } catch {
    return "";
  }
}

/**
 * OCR any uploadable scan: image files are OCR'd directly, PDFs are
 * rendered page-by-page first. Returns "" for other types / on failure.
 */
export async function ocrAnyFile(
  file: File | Blob,
  opts: { maxPages?: number; onProgress?: (p: OcrProgress) => void } = {},
): Promise<string> {
  const type = file.type || "";
  const name = file instanceof File ? file.name.toLowerCase() : "";
  if (type.startsWith("image/")) return ocrImage(file, opts.onProgress);
  if (type === "application/pdf" || name.endsWith(".pdf"))
    return ocrPdf(file, opts);
  return "";
}

/**
 * Extract the native text layer of a PDF. Returns "" when the PDF is
 * image-only (scanned) or has no extractable text.
 */
export async function extractPdfText(
  file: File | Blob,
  maxPages = 5,
): Promise<string> {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
  const buf = new Uint8Array(await file.arrayBuffer());
  const pdf = await pdfjs.getDocument({ data: buf }).promise;
  let text = "";
  const pages = Math.min(pdf.numPages, maxPages);
  for (let p = 1; p <= pages; p++) {
    const page = await pdf.getPage(p);
    const content = await page.getTextContent();
    text +=
      content.items.map((it) => ("str" in it ? it.str : "")).join(" ") + "\n";
  }
  return text;
}

export interface SmartPdfTextResult {
  text: string;
  /** How the text was obtained — lets the UI say "read visually (OCR)". */
  method: "pdf-text" | "ocr" | "none";
}

/**
 * The smart path for every PDF upload: try the native text layer first
 * (instant, exact); when the page is image-only (a scan), fall back to
 * visual OCR automatically.
 */
export async function extractPdfTextSmart(
  file: File | Blob,
  opts: {
    maxPages?: number;
    minCharsPerPage?: number;
    onProgress?: (p: OcrProgress) => void;
  } = {},
): Promise<SmartPdfTextResult> {
  const { maxPages = 5, minCharsPerPage = 20, onProgress } = opts;
  try {
    const text = await extractPdfText(file, maxPages);
    if (text.trim().length >= minCharsPerPage)
      return { text, method: "pdf-text" };
  } catch {
    /* fall through to OCR */
  }
  const ocrText = await ocrPdf(file, { maxPages, onProgress });
  if (ocrText.trim()) return { text: ocrText, method: "ocr" };
  return { text: "", method: "none" };
}
