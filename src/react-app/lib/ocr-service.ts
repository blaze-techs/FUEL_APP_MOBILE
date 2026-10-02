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
import { loadPdfDocument } from "@/react-app/lib/pdf-loader";

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
    options?: Record<string, unknown>,
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
  password?: string,
): Promise<HTMLCanvasElement[]> {
  const pdf = await loadPdfDocument(
    new Uint8Array(await file.arrayBuffer()),
    password,
  );
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
async function imageToCanvas(
  image: Blob | HTMLCanvasElement,
  scale = 2,
): Promise<HTMLCanvasElement | null> {
  if (typeof document === "undefined") return null;
  if (image instanceof HTMLCanvasElement) {
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.width * scale));
    canvas.height = Math.max(1, Math.round(image.height * scale));
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return null;
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    return canvas;
  }

  try {
    if (typeof createImageBitmap === "function") {
      const bitmap = await createImageBitmap(image);
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      if (!ctx) {
        bitmap.close?.();
        return null;
      }
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      bitmap.close?.();
      return canvas;
    }
  } catch {
    // Fall through to the HTMLImageElement path below.
  }

  return new Promise((resolve) => {
    const url = URL.createObjectURL(image);
    const img = new Image();
    img.onload = () => {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
        canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        if (!ctx) {
          resolve(null);
          return;
        }
        ctx.fillStyle = "#fff";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas);
      } finally {
        URL.revokeObjectURL(url);
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(null);
    };
    img.src = url;
  });
}

/**
 * Produce a high-contrast grayscale canvas for faint/blue-ink handwriting.
 * This is intentionally conservative: it enhances ink without hard
 * thresholding, because thresholding can erase thin handwritten strokes.
 */
function enhanceHandwritingCanvas(source: HTMLCanvasElement): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = source.width;
  canvas.height = source.height;
  const srcCtx = source.getContext("2d", { willReadFrequently: true });
  const dstCtx = canvas.getContext("2d", { willReadFrequently: true });
  if (!srcCtx || !dstCtx) return source;

  const image = srcCtx.getImageData(0, 0, source.width, source.height);
  const data = image.data;
  for (let i = 0; i < data.length; i += 4) {
    const gray =
      0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    // Lift the paper toward white while keeping dark ink strong.
    const normalized = Math.max(0, Math.min(255, (gray - 128) * 1.55 + 128));
    data[i] = normalized;
    data[i + 1] = normalized;
    data[i + 2] = normalized;
    data[i + 3] = 255;
  }
  dstCtx.putImageData(image, 0, 0);
  return canvas;
}

/**
 * OCR an image using a raw pass plus a handwriting-enhanced pass. Multiple
 * passes are joined because the parser is deliberately idempotent and
 * deduplicates identical meter blocks.
 */
export async function ocrImage(
  image: Blob | HTMLCanvasElement,
  onProgress?: (p: OcrProgress) => void,
): Promise<string> {
  try {
    progressSink = (p) => onProgress?.({ progress: p, stage: "recognizing" });
    const worker = await getOcrWorker();

    // Handwritten fuel sheets benefit from several page-segmentation modes:
    // 6 = structured block, 11 = sparse text, 12 = sparse text with OSD.
    // We keep the raw pass as well, then let the deterministic sales parser
    // reconcile duplicates. This is still fully on-device and sends no image
    // or station data to a third party.
    const source = await imageToCanvas(image, 3.5);
    const targets: Array<Blob | HTMLCanvasElement> = source
      ? [image, enhanceHandwritingCanvas(source)]
      : [image];

    const texts: string[] = [];
    for (const target of targets) {
      for (const psm of ["4", "6", "11", "12", "13"]) {
        try {
          const result = await worker.recognize(target, {
            tessedit_pageseg_mode: psm,
            preserve_interword_spaces: "1",
          });
          const text = result.data.text || "";
          if (text.trim()) texts.push(text);
        } catch {
          // One segmentation pass failing must not discard the successful
          // passes from the same image.
        }
      }
    }

    if (source) {
      source.width = 1;
      source.height = 1;
    }

    // Keep all passes. The downstream parser deduplicates identical meter
    // blocks, while retaining genuinely different OCR interpretations for
    // labels and faint handwriting.
    return texts.join("\\n");
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
    password?: string;
    /** Called after each page so callers can consume large statements incrementally. */
    onPageText?: (pageNumber: number, text: string) => void;
  } = {},
): Promise<string> {
  const {
    maxPages = Number.POSITIVE_INFINITY,
    onProgress,
    password,
    onPageText,
  } = opts;
  let pdf: Awaited<ReturnType<typeof loadPdfDocument>> | null = null;
  try {
    onProgress?.({ progress: 0, stage: "rendering" });
    pdf = await loadPdfDocument(
      new Uint8Array(await file.arrayBuffer()),
      password,
    );
    const count = Math.min(pdf.numPages, maxPages);
    let text = "";
    for (let p = 1; p <= count; p++) {
      const page = await pdf.getPage(p);
      const viewport = page.getViewport({ scale: 2.5 });
      const canvas = document.createElement("canvas");
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        page.cleanup?.();
        continue;
      }
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvasContext: ctx, viewport }).promise;

      const pageText = await ocrImage(canvas, (pageProgress) =>
        onProgress?.({
          progress: count > 0 ? (p - 1 + pageProgress.progress) / count : 0,
          stage: "recognizing",
        }),
      );

      if (pageText.trim()) {
        text += pageText + "\n";
        onPageText?.(p, pageText);
      }

      // Release page/canvas memory immediately. This is critical for
      // 50–500+ page merchant statements on phones and low-memory WebViews.
      page.cleanup?.();
      canvas.width = 1;
      canvas.height = 1;

      if (p % 5 === 0 || p === count) {
        onProgress?.({
          progress: count > 0 ? p / count : 1,
          stage: "rendering",
        });
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
      }
    }
    return text;
  } catch {
    return "";
  } finally {
    try {
      pdf?.cleanup?.();
      pdf?.destroy?.();
    } catch {
      // Best-effort cleanup only.
    }
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
  const pdf = await loadPdfDocument(new Uint8Array(await file.arrayBuffer()));
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
