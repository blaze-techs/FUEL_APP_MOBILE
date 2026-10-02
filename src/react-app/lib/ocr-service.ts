/** Shared OCR service. Gemini vision is the primary reader; on-device Tesseract is the deterministic fallback. */
import { loadPdfDocument } from "@/react-app/lib/pdf-loader";
import { geminiOcrDocument, geminiExtractFuelSales, fuelGeminiResultToSalesText } from "@/react-app/lib/gemini-vision-ocr";

const TESS_ASSETS = "/tessdata";
export interface OcrProgress { progress: number; stage: "loading-engine" | "rendering" | "recognizing"; }
interface OcrWorker { recognize: (image: Blob | HTMLCanvasElement, options?: Record<string, unknown>) => Promise<{ data: { text: string } }>; terminate: () => Promise<void>; }
let workerPromise: Promise<OcrWorker> | null = null;
let progressSink: ((p: number) => void) | undefined;

async function getOcrWorker(): Promise<OcrWorker> {
  if (!workerPromise) {
    workerPromise = (async () => {
      const { createWorker } = await import("tesseract.js");
      return await createWorker("eng", 1, {
        workerPath: `${TESS_ASSETS}/worker.min.js`, corePath: TESS_ASSETS, langPath: TESS_ASSETS, gzip: true, cacheMethod: "write",
        logger: (m: { status?: string; progress?: number }) => { if (m?.status === "recognizing text" && typeof m.progress === "number") progressSink?.(m.progress); },
        errorHandler: () => {},
      }) as unknown as OcrWorker;
    })();
    workerPromise.catch(() => { workerPromise = null; });
  }
  return workerPromise;
}

export async function renderPdfPagesForOcr(file: File | Blob, maxPages = 2, scale = 2.5, password?: string): Promise<HTMLCanvasElement[]> {
  const pdf = await loadPdfDocument(new Uint8Array(await file.arrayBuffer()), password);
  const pages: HTMLCanvasElement[] = [];
  const count = Math.min(pdf.numPages, maxPages);
  for (let p = 1; p <= count; p++) {
    const page = await pdf.getPage(p); const viewport = page.getViewport({ scale });
    const canvas = document.createElement("canvas"); canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height);
    const ctx = canvas.getContext("2d"); if (!ctx) continue; ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport }).promise; pages.push(canvas); page.cleanup?.();
  }
  return pages;
}

async function imageToCanvas(image: Blob | HTMLCanvasElement, scale = 4): Promise<HTMLCanvasElement | null> {
  if (typeof document === "undefined") return null;
  if (image instanceof HTMLCanvasElement) {
    const canvas = document.createElement("canvas"); canvas.width = Math.max(1, Math.round(image.width * scale)); canvas.height = Math.max(1, Math.round(image.height * scale));
    const ctx = canvas.getContext("2d", { willReadFrequently: true }); if (!ctx) return null; ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, canvas.width, canvas.height); ctx.drawImage(image, 0, 0, canvas.width, canvas.height); return canvas;
  }
  try {
    if (typeof createImageBitmap === "function") {
      const bitmap = await createImageBitmap(image, { imageOrientation: "from-image" }).catch(() => createImageBitmap(image));
      const canvas = document.createElement("canvas"); canvas.width = Math.max(1, Math.round(bitmap.width * scale)); canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      const ctx = canvas.getContext("2d", { willReadFrequently: true }); if (!ctx) { bitmap.close?.(); return null; }
      ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, canvas.width, canvas.height); ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height); bitmap.close?.(); return canvas;
    }
  } catch { /* fallback below */ }
  return new Promise((resolve) => {
    const url = URL.createObjectURL(image); const img = new Image();
    img.onload = () => { try { const canvas = document.createElement("canvas"); canvas.width = Math.max(1, Math.round(img.naturalWidth * scale)); canvas.height = Math.max(1, Math.round(img.naturalHeight * scale)); const ctx = canvas.getContext("2d", { willReadFrequently: true }); if (!ctx) return resolve(null); ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, canvas.width, canvas.height); ctx.drawImage(img, 0, 0, canvas.width, canvas.height); resolve(canvas); } finally { URL.revokeObjectURL(url); } };
    img.onerror = () => { URL.revokeObjectURL(url); resolve(null); }; img.src = url;
  });
}

function enhanceHandwritingCanvas(source: HTMLCanvasElement): HTMLCanvasElement {
  const canvas = document.createElement("canvas"); canvas.width = source.width; canvas.height = source.height;
  const srcCtx = source.getContext("2d", { willReadFrequently: true }); const dstCtx = canvas.getContext("2d", { willReadFrequently: true }); if (!srcCtx || !dstCtx) return source;
  const image = srcCtx.getImageData(0, 0, source.width, source.height); const data = image.data;
  for (let i = 0; i < data.length; i += 4) { const gray = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]; const normalized = Math.max(0, Math.min(255, (gray - 128) * 1.75 + 128)); data[i] = normalized; data[i + 1] = normalized; data[i + 2] = normalized; data[i + 3] = 255; }
  dstCtx.putImageData(image, 0, 0); return canvas;
}
function makeNumericCanvas(source: HTMLCanvasElement): HTMLCanvasElement {
  const canvas = document.createElement("canvas"); canvas.width = source.width; canvas.height = source.height; const srcCtx = source.getContext("2d", { willReadFrequently: true }); const dstCtx = canvas.getContext("2d", { willReadFrequently: true }); if (!srcCtx || !dstCtx) return source;
  const image = srcCtx.getImageData(0, 0, source.width, source.height); const data = image.data;
  for (let i = 0; i < data.length; i += 4) { const gray = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]; const v = gray < 190 ? 25 : 255; data[i] = v; data[i + 1] = v; data[i + 2] = v; data[i + 3] = 255; }
  dstCtx.putImageData(image, 0, 0); return canvas;
}
async function recognizePass(worker: OcrWorker, target: Blob | HTMLCanvasElement, psm: string, numeric = false): Promise<string> {
  const options: Record<string, unknown> = { tessedit_pageseg_mode: psm, preserve_interword_spaces: "1" };
  if (numeric) { options.tessedit_char_whitelist = "0123456789.,:-=()"; options.classify_bln_numeric_mode = "1"; }
  return (await worker.recognize(target, options)).data.text || "";
}

async function localOcrImage(image: Blob | HTMLCanvasElement, onProgress?: (p: OcrProgress) => void): Promise<string> {
  progressSink = (p) => onProgress?.({ progress: p, stage: "recognizing" });
  try {
    const worker = await getOcrWorker(); const source = await imageToCanvas(image, 4); const enhanced = source ? enhanceHandwritingCanvas(source) : null; const numeric = enhanced ? makeNumericCanvas(enhanced) : null;
    const targets: Array<{ image: Blob | HTMLCanvasElement; numeric: boolean }> = [{ image, numeric: false }]; if (enhanced) targets.push({ image: enhanced, numeric: false }); if (numeric) targets.push({ image: numeric, numeric: true });
    const texts: string[] = [];
    for (const target of targets) for (const psm of target.numeric ? ["4", "6", "11"] : ["4", "6", "11", "12"]) { try { const text = await recognizePass(worker, target.image, psm, target.numeric); if (text.trim()) texts.push(text); } catch {} }
    return texts.join("\n");
  } catch { return ""; } finally { progressSink = undefined; }
}

function tokenFromBrowser(): string | null { try { return localStorage.getItem("fuelpro_token"); } catch { return null; } }

/**
 * Gemini is attempted first for an actual File. If the provider is unavailable,
 * unauthenticated, too large, or not configured, the existing on-device OCR
 * remains the fallback so uploads never become unusable.
 */
export async function ocrImage(image: Blob | HTMLCanvasElement, onProgress?: (p: OcrProgress) => void): Promise<string> {
  if (image instanceof Blob && typeof File !== "undefined" && image instanceof File) {
    try {
      onProgress?.({ progress: 0.05, stage: "loading-engine" });
      const ai = await geminiOcrDocument(image, undefined, tokenFromBrowser());
      if (ai.text.trim()) { onProgress?.({ progress: 1, stage: "recognizing" }); return ai.text; }
    } catch { /* local OCR fallback */ }
  }
  return localOcrImage(image, onProgress);
}

export async function ocrPdf(file: File | Blob, opts: { maxPages?: number; onProgress?: (p: OcrProgress) => void; password?: string; onPageText?: (pageNumber: number, text: string) => void } = {}): Promise<string> {
  const { maxPages = Number.POSITIVE_INFINITY, onProgress, password, onPageText } = opts;
  // For PDFs, Gemini sees the original document instead of a lossy browser
  // screenshot. This is the preferred path for scanned statements and mixed PDFs.
  if (typeof File !== "undefined" && file instanceof File) {
    try {
      onProgress?.({ progress: 0.05, stage: "loading-engine" });
      const ai = await geminiOcrDocument(file, undefined, tokenFromBrowser());
      if (ai.text.trim()) { onProgress?.({ progress: 1, stage: "recognizing" }); onPageText?.(1, ai.text); return ai.text; }
    } catch { /* local PDF OCR fallback */ }
  }
  let pdf: Awaited<ReturnType<typeof loadPdfDocument>> | null = null;
  try {
    onProgress?.({ progress: 0, stage: "rendering" }); pdf = await loadPdfDocument(new Uint8Array(await file.arrayBuffer()), password); const count = Math.min(pdf.numPages, maxPages); let text = "";
    for (let p = 1; p <= count; p++) {
      const page = await pdf.getPage(p); const viewport = page.getViewport({ scale: 2.5 }); const canvas = document.createElement("canvas"); canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height); const ctx = canvas.getContext("2d"); if (!ctx) continue;
      ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, canvas.width, canvas.height); await page.render({ canvasContext: ctx, viewport }).promise;
      const pageText = await localOcrImage(canvas, (progress) => onProgress?.({ progress: count > 0 ? (p - 1 + progress.progress) / count : 0, stage: progress.stage }));
      if (pageText.trim()) { text += `${pageText}\n`; onPageText?.(p, pageText); }
      page.cleanup?.(); canvas.width = canvas.height = 1; if (p % 5 === 0 || p === count) { onProgress?.({ progress: count > 0 ? p / count : 1, stage: "rendering" }); await new Promise<void>((r) => setTimeout(r, 0)); }
    }
    return text;
  } catch { return ""; } finally { try { pdf?.cleanup?.(); pdf?.destroy?.(); } catch {} }
}

export async function ocrAnyFile(file: File | Blob, opts: { maxPages?: number; onProgress?: (p: OcrProgress) => void } = {}): Promise<string> {
  const type = file.type || ""; const name = file instanceof File ? file.name.toLowerCase() : "";
  if (type.startsWith("image/") || type === "application/pdf" || name.endsWith(".pdf")) {
    // Fuel Sales Tracking is the primary handwritten-number consumer of this
    // generic upload API. Use structured Gemini extraction and convert it into
    // the existing deterministic parser format; if Gemini fails, ocrImage/PDF
    // falls back to local OCR exactly as before.
    if (typeof File !== "undefined" && file instanceof File) {
      try {
        const fuel = await geminiExtractFuelSales(file, undefined, tokenFromBrowser());
        const text = fuelGeminiResultToSalesText(fuel);
        if (text.trim()) return text;
      } catch { /* fallback */ }
    }
    if (type.startsWith("image/")) return ocrImage(file, opts.onProgress);
    return ocrPdf(file, opts);
  }
  return "";
}

export async function extractPdfText(file: File | Blob, maxPages = 5): Promise<string> {
  const pdf = await loadPdfDocument(new Uint8Array(await file.arrayBuffer())); let text = ""; const pages = Math.min(pdf.numPages, maxPages);
  for (let p = 1; p <= pages; p++) { const page = await pdf.getPage(p); const content = await page.getTextContent(); text += content.items.map((it) => ("str" in it ? it.str : "")).join(" ") + "\n"; page.cleanup?.(); }
  pdf.cleanup?.(); pdf.destroy?.(); return text;
}
export interface SmartPdfTextResult { text: string; method: "pdf-text" | "ocr" | "none"; }
export async function extractPdfTextSmart(file: File | Blob, opts: { maxPages?: number; minCharsPerPage?: number; onProgress?: (p: OcrProgress) => void } = {}): Promise<SmartPdfTextResult> {
  const { maxPages = 5, minCharsPerPage = 20, onProgress } = opts;
  try { const text = await extractPdfText(file, maxPages); if (text.trim().length >= minCharsPerPage) return { text, method: "pdf-text" }; } catch {}
  const ocrText = await ocrPdf(file, { maxPages, onProgress }); if (ocrText.trim()) return { text: ocrText, method: "ocr" }; return { text: "", method: "none" };
}
