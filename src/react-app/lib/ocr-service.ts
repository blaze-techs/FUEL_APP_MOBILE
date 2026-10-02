/** Shared on-device OCR service used by FuelPro uploads and sales scans. */
import { loadPdfDocument } from "@/react-app/lib/pdf-loader";

const TESS_ASSETS = "/tessdata";

export interface OcrProgress {
  progress: number;
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
let progressSink: ((p: number) => void) | undefined;

async function getOcrWorker(): Promise<OcrWorker> {
  if (!workerPromise) {
    workerPromise = (async () => {
      const { createWorker } = await import("tesseract.js");
      const worker = await createWorker("eng", 1, {
        workerPath: `${TESS_ASSETS}/worker.min.js`,
        corePath: TESS_ASSETS,
        langPath: TESS_ASSETS,
        gzip: true,
        cacheMethod: "write",
        logger: (m: { status?: string; progress?: number }) => {
          if (m?.status === "recognizing text" && typeof m.progress === "number")
            progressSink?.(m.progress);
        },
        errorHandler: () => {},
      });
      return worker as unknown as OcrWorker;
    })();
    workerPromise.catch(() => {
      workerPromise = null;
    });
  }
  return workerPromise;
}

export async function renderPdfPagesForOcr(
  file: File | Blob,
  maxPages = 2,
  scale = 2.5,
  password?: string,
): Promise<HTMLCanvasElement[]> {
  const pdf = await loadPdfDocument(new Uint8Array(await file.arrayBuffer()), password);
  const pages: HTMLCanvasElement[] = [];
  const count = Math.min(pdf.numPages, maxPages);
  for (let p = 1; p <= count; p++) {
    const page = await pdf.getPage(p);
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    const ctx = canvas.getContext("2d");
    if (!ctx) break;
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport }).promise;
    pages.push(canvas);
  }
  return pages;
}

async function imageToCanvas(
  image: Blob | HTMLCanvasElement,
  scale = 4,
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
      let bitmap: ImageBitmap;
      try {
        bitmap = await createImageBitmap(image, { imageOrientation: "from-image" });
      } catch {
        bitmap = await createImageBitmap(image);
      }
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
    // Fall through to HTMLImageElement.
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
    const gray = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    const normalized = Math.max(0, Math.min(255, (gray - 128) * 1.75 + 128));
    data[i] = normalized;
    data[i + 1] = normalized;
    data[i + 2] = normalized;
    data[i + 3] = 255;
  }
  dstCtx.putImageData(image, 0, 0);
  return canvas;
}

/** High-contrast numeric image; used only as additional OCR evidence. */
function makeNumericCanvas(source: HTMLCanvasElement): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = source.width;
  canvas.height = source.height;
  const srcCtx = source.getContext("2d", { willReadFrequently: true });
  const dstCtx = canvas.getContext("2d", { willReadFrequently: true });
  if (!srcCtx || !dstCtx) return source;
  const image = srcCtx.getImageData(0, 0, source.width, source.height);
  const data = image.data;
  for (let i = 0; i < data.length; i += 4) {
    const gray = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    // Conservative binarisation: preserve thin blue/black handwriting while
    // suppressing most of the notebook paper/background.
    const v = gray < 190 ? 25 : 255;
    data[i] = v;
    data[i + 1] = v;
    data[i + 2] = v;
    data[i + 3] = 255;
  }
  dstCtx.putImageData(image, 0, 0);
  return canvas;
}

async function recognizePass(
  worker: OcrWorker,
  target: Blob | HTMLCanvasElement,
  psm: string,
  numeric = false,
): Promise<string> {
  const options: Record<string, unknown> = {
    tessedit_pageseg_mode: psm,
    preserve_interword_spaces: "1",
  };
  if (numeric) {
    options.tessedit_char_whitelist = "0123456789.,:-=()";
    options.classify_bln_numeric_mode = "1";
  }
  const result = await worker.recognize(target, options);
  return result.data.text || "";
}

/**
 * Multi-pass handwriting OCR. Normal passes recover labels; numeric-only
 * passes recover meter values that Tesseract otherwise confuses with letters.
 * All passes stay on-device and are reconciled by the deterministic parser.
 */
export async function ocrImage(
  image: Blob | HTMLCanvasElement,
  onProgress?: (p: OcrProgress) => void,
): Promise<string> {
  try {
    progressSink = (p) => onProgress?.({ progress: p, stage: "recognizing" });
    const worker = await getOcrWorker();
    const source = await imageToCanvas(image, 4);
    const enhanced = source ? enhanceHandwritingCanvas(source) : null;
    const numeric = enhanced ? makeNumericCanvas(enhanced) : null;
    const targets: Array<{ image: Blob | HTMLCanvasElement; numeric: boolean }> = [
      { image, numeric: false },
    ];
    if (enhanced) targets.push({ image: enhanced, numeric: false });
    if (numeric) targets.push({ image: numeric, numeric: true });

    const texts: string[] = [];
    for (const target of targets) {
      const psms = target.numeric ? ["4", "6", "11"] : ["4", "6", "11", "12"];
      for (const psm of psms) {
        try {
          const text = await recognizePass(worker, target.image, psm, target.numeric);
          if (text.trim()) texts.push(text);
        } catch {
          // Keep other successful passes.
        }
      }
    }

    if (source) source.width = source.height = 1;
    if (enhanced && enhanced !== source) enhanced.width = enhanced.height = 1;
    if (numeric && numeric !== enhanced) numeric.width = numeric.height = 1;
    return texts.join("\n");
  } catch {
    return "";
  } finally {
    progressSink = undefined;
  }
}

export async function ocrPdf(
  file: File | Blob,
  opts: {
    maxPages?: number;
    onProgress?: (p: OcrProgress) => void;
    password?: string;
    onPageText?: (pageNumber: number, text: string) => void;
  } = {},
): Promise<string> {
  const { maxPages = Number.POSITIVE_INFINITY, onProgress, password, onPageText } = opts;
  let pdf: Awaited<ReturnType<typeof loadPdfDocument>> | null = null;
  try {
    onProgress?.({ progress: 0, stage: "rendering" });
    pdf = await loadPdfDocument(new Uint8Array(await file.arrayBuffer()), password);
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
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvasContext: ctx, viewport }).promise;
      const pageText = await ocrImage(canvas, (progress) =>
        onProgress?.({ progress: count > 0 ? (p - 1 + progress.progress) / count : 0, stage: progress.stage }),
      );
      if (pageText.trim()) {
        text += `${pageText}\n`;
        onPageText?.(p, pageText);
      }
      page.cleanup?.();
      canvas.width = canvas.height = 1;
      if (p % 5 === 0 || p === count) {
        onProgress?.({ progress: count > 0 ? p / count : 1, stage: "rendering" });
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
      // Best effort.
    }
  }
}

export async function ocrAnyFile(
  file: File | Blob,
  opts: { maxPages?: number; onProgress?: (p: OcrProgress) => void } = {},
): Promise<string> {
  const type = file.type || "";
  const name = file instanceof File ? file.name.toLowerCase() : "";
  if (type.startsWith("image/")) return ocrImage(file, opts.onProgress);
  if (type === "application/pdf" || name.endsWith(".pdf")) return ocrPdf(file, opts);
  return "";
}

export async function extractPdfText(file: File | Blob, maxPages = 5): Promise<string> {
  const pdf = await loadPdfDocument(new Uint8Array(await file.arrayBuffer()));
  let text = "";
  const pages = Math.min(pdf.numPages, maxPages);
  for (let p = 1; p <= pages; p++) {
    const page = await pdf.getPage(p);
    const content = await page.getTextContent();
    text += content.items.map((it) => ("str" in it ? it.str : "")).join(" ") + "\n";
  }
  return text;
}

export interface SmartPdfTextResult {
  text: string;
  method: "pdf-text" | "ocr" | "none";
}

export async function extractPdfTextSmart(
  file: File | Blob,
  opts: { maxPages?: number; minCharsPerPage?: number; onProgress?: (p: OcrProgress) => void } = {},
): Promise<SmartPdfTextResult> {
  const { maxPages = 5, minCharsPerPage = 20, onProgress } = opts;
  try {
    const text = await extractPdfText(file, maxPages);
    if (text.trim().length >= minCharsPerPage) return { text, method: "pdf-text" };
  } catch {
    // Fall through to visual OCR.
  }
  const ocrText = await ocrPdf(file, { maxPages, onProgress });
  if (ocrText.trim()) return { text: ocrText, method: "ocr" };
  return { text: "", method: "none" };
}
