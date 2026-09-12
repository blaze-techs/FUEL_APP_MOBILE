import { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

/**
 * Renders PDF bytes (jsPDF output or any uploaded PDF) to canvas pages via pdfjs-dist.
 * Works in every browser — including Android WebView and Safari, which
 * cannot display PDFs inside an <iframe> (the previous blob-URL iframe
 * approach rendered blank there).
 */
export default function PdfCanvasPreview({ bytes }: { bytes: Uint8Array }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const container = containerRef.current;
    if (!container) return;
    container.innerHTML = "";
    setLoading(true);
    setError(null);

    (async () => {
      try {
        const pdfjs = await import("pdfjs-dist");
        pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
        const pdf = await pdfjs.getDocument({ data: bytes }).promise;
        for (let p = 1; p <= pdf.numPages; p++) {
          if (cancelled) return;
          const page = await pdf.getPage(p);
          const viewport = page.getViewport({ scale: 2 });
          const canvas = document.createElement("canvas");
          canvas.width = viewport.width;
          canvas.height = viewport.height;
          canvas.style.width = "100%";
          canvas.style.height = "auto";
          canvas.style.background = "#ffffff";
          canvas.style.borderRadius = "8px";
          canvas.style.boxShadow = "0 1px 4px rgba(0,0,0,0.35)";
          const ctx = canvas.getContext("2d");
          if (!ctx) throw new Error("Canvas 2D is not available");
          await page.render({ canvasContext: ctx, viewport }).promise;
          container.appendChild(canvas);
        }
        if (!cancelled) setLoading(false);
      } catch (e) {
        if (!cancelled) {
          setError((e as Error).message || "Could not render the preview");
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [bytes]);

  return (
    <div className="relative h-full w-full min-h-[60vh] overflow-y-auto bg-gray-100 dark:bg-gray-900 p-3">
      {loading && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-gray-500 dark:text-gray-400">
          <Loader2 className="animate-spin" size={22} />
          <span className="text-sm">Rendering preview…</span>
        </div>
      )}
      {error && (
        <div className="absolute inset-0 flex items-center justify-center p-6 text-center text-sm text-gray-600 dark:text-gray-300">
          Preview could not be rendered ({error}). Use{" "}
          <strong>&nbsp;Download PDF&nbsp;</strong> instead.
        </div>
      )}
      <div ref={containerRef} className="space-y-3" />
    </div>
  );
}
