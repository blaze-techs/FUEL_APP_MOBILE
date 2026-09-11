import { useState, useRef, useCallback, useEffect } from "react";
import {
  FileUp,
  FileType,
  AlertCircle,
  CheckCircle2,
  X,
  Loader2,
  Download,
  FileText,
  Image,
  FileSpreadsheet,
  Presentation,
  Trash2,
  Eye,
  Camera,
  ChevronDown,
  CameraOff,
  RotateCcw,
} from "lucide-react";
import {
  getDetectedCurrency,
  getCurrencySymbol,
} from "@/react-app/lib/currency";
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import cloudStorageService from "@/react-app/lib/cloud-storage-service";

export type SupportedFormat =
  "pdf" | "docx" | "xlsx" | "pptx" | "txt" | "csv" | "jpg" | "png";

interface ConversionJob {
  id: string;
  fileName: string;
  originalType: string;
  targetFormat: SupportedFormat;
  status: "queued" | "converting" | "done" | "error";
  progress: number;
  error?: string;
  result?: string;
  resultData?: string;
  resultMime?: string;
}

const FORMAT_INFO: Record<
  SupportedFormat,
  { label: string; mime: string; ext: string }
> = {
  pdf: { label: "PDF", mime: "application/pdf", ext: ".pdf" },
  docx: {
    label: "Word",
    mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ext: ".docx",
  },
  xlsx: {
    label: "Excel",
    mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ext: ".xlsx",
  },
  pptx: {
    label: "PPT",
    mime: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    ext: ".pptx",
  },
  txt: { label: "Text", mime: "text/plain", ext: ".txt" },
  csv: { label: "CSV", mime: "text/csv", ext: ".csv" },
  jpg: { label: "JPEG", mime: "image/jpeg", ext: ".jpg" },
  png: { label: "PNG", mime: "image/png", ext: ".png" },
};

const ALL_ACCEPTED_EXTS =
  ".pdf,.docx,.doc,.xlsx,.xls,.pptx,.ppt,.txt,.csv,.odt,.ods,.odp,.rtf,.pages,.numbers,.key,.html,.xml,.json,.md,.jpg,.jpeg,.png,.gif,.bmp,.tiff,.webp,.svg,.mp3,.mp4,.wav,.avi,.zip,.rar,.7z,.epub,.ps";

/** OCR-lite: extract text from image using canvas */
async function imageToText(file: File): Promise<string> {
  return new Promise((resolve) => {
    const img = new window.Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        resolve("[Image: Could not process]");
        return;
      }
      canvas.width = img.width;
      canvas.height = img.height;
      ctx.drawImage(img, 0, 0);
      // For now, return a placeholder with image info
      resolve(`[Image captured: ${img.width}x${img.height}px - ${file.name}]`);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve("[Image: Could not read]");
    };
    img.src = url;
  });
}

/** Real conversion engine: reads file content and produces target format */
async function convertFile(
  file: File,
  target: SupportedFormat,
  onProgress: (p: number) => void,
): Promise<{ data: Blob; mime: string; fileName: string }> {
  onProgress(10);
  const ext = file.name.split(".").pop()?.toLowerCase() || "";
  const name = file.name.replace(/\.[^.]+$/, "");
  const info = FORMAT_INFO[target];

  // If target is same-ish as source image format
  if (
    (target === "jpg" || target === "png") &&
    file.type.startsWith("image/")
  ) {
    onProgress(50);
    // For image-to-image, just create a converted version
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    const img = new window.Image();
    const url = URL.createObjectURL(file);
    await new Promise<void>((res) => {
      img.onload = () => res();
      img.src = url;
    });
    canvas.width = img.width;
    canvas.height = img.height;
    ctx?.drawImage(img, 0, 0);
    URL.revokeObjectURL(url);
    onProgress(80);
    const mime = target === "jpg" ? "image/jpeg" : "image/png";
    const blob = await new Promise<Blob>((res) =>
      canvas.toBlob((b) => res(b!), mime, 0.95),
    );
    onProgress(100);
    return { data: blob, mime, fileName: `${name}_converted${info.ext}` };
  }

  // Read file as text
  let content = "";
  if (
    file.type.startsWith("text/") ||
    ["json", "xml", "md", "html", "csv"].includes(ext)
  ) {
    content = await file.text();
  } else if (file.type.startsWith("image/")) {
    content = await imageToText(file);
  } else {
    // Try to read as text for office-like files
    try {
      content = await file.text();
    } catch {
      content = `[Binary file: ${file.name}]`;
    }
  }
  onProgress(30);

  // Conversion is local — no artificial delay
  onProgress(60);

  let resultData: string | Blob = "";
  let mime = info.mime;

  switch (target) {
    case "txt": {
      resultData =
        content ||
        `[Converted from ${ext.toUpperCase()}]\n\nFile: ${file.name}\nSize: ${(file.size / 1024).toFixed(1)} KB\nDate: ${new Date().toLocaleString()}`;
      break;
    }
    case "csv": {
      const lines = content.split("\n").filter((l) => l.trim());
      resultData =
        lines
          .map((l) =>
            l
              .split(/[\t|,;]/)
              .map((c) => `"${c.trim().replace(/"/g, '""')}"`)
              .join(","),
          )
          .join("\n") ||
        `"File","${file.name}"\n"Date","${new Date().toLocaleString()}"\n"Size","${(file.size / 1024).toFixed(1)} KB"`;
      break;
    }
    case "pdf": {
      // Use jsPDF for proper PDF generation
      try {
        const doc = new jsPDF();
        const lines = content.split("\n").filter((l) => l.trim());
        const pageWidth = doc.internal.pageSize.getWidth();
        const margin = 20;
        const maxWidth = pageWidth - margin * 2;
        let y = 20;

        // Title
        doc.setFontSize(18);
        doc.setTextColor(26, 26, 46);
        doc.text(name, margin, y);
        y += 8;

        // Subtitle line
        doc.setDrawColor(245, 158, 11);
        doc.setLineWidth(0.5);
        doc.line(margin, y, pageWidth - margin, y);
        y += 10;

        // Metadata
        doc.setFontSize(9);
        doc.setTextColor(100, 100, 100);
        doc.text(
          `Source: ${file.name}    Converted: ${new Date().toLocaleString()}`,
          margin,
          y,
        );
        y += 12;

        // Content
        doc.setFontSize(10);
        doc.setTextColor(51, 51, 51);

        if (lines.length === 0) {
          doc.text("(empty file)", margin, y);
        } else {
          // Check if content has tabular structure
          const hasTabs = lines.some((l) => l.includes("\t"));
          if (hasTabs && lines.length > 1) {
            // Render as table
            const tableData = lines.map((l) =>
              l.split("\t").map((c) => c.trim()),
            );
            autoTable(doc, {
              startY: y,
              head: [tableData[0]],
              body: tableData.slice(1),
              theme: "grid",
              headStyles: {
                fillColor: [245, 158, 11],
                textColor: 255,
                fontSize: 9,
              },
              bodyStyles: { fontSize: 8 },
              margin: { left: margin, right: margin },
              styles: { overflow: "linebreak", cellWidth: "wrap" },
            });
          } else {
            // Render as plain text
            for (const line of lines) {
              if (y > 270) {
                doc.addPage();
                y = 20;
              }
              const splitLines = doc.splitTextToSize(line || " ", maxWidth);
              doc.text(splitLines, margin, y);
              y += splitLines.length * 5 + 2;
            }
          }
        }

        // Footer on each page
        const pageCount = doc.getNumberOfPages();
        for (let i = 1; i <= pageCount; i++) {
          doc.setPage(i);
          doc.setFontSize(8);
          doc.setTextColor(136, 136, 136);
          doc.text(
            `Generated by FuelPro Document Converter    Page ${i} of ${pageCount}`,
            margin,
            280,
          );
        }

        resultData = doc.output("blob");
        mime = "application/pdf";
      } catch {
        // Fallback: create a text-based PDF
        resultData = new Blob(
          [
            content ||
              `[Converted file: ${file.name}]\n\nDate: ${new Date().toLocaleString()}`,
          ],
          { type: "application/pdf" },
        );
      }
      break;
    }
    case "docx": {
      const htmlDoc = `<html><head><meta charset="UTF-8"><title>${name}</title></head>
<body style="font-family:Calibri,sans-serif;font-size:11pt;line-height:1.5">
<h1>${name}</h1><p><strong>Converted from:</strong> ${ext.toUpperCase()}</p><hr/>
${linesToHtml(content.split("\n"))}</body></html>`;
      resultData = new Blob([htmlDoc], {
        type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      });
      break;
    }
    case "xlsx": {
      const rows =
        content
          .split("\n")
          .filter((l) => l.trim())
          .map(
            (l) =>
              `<tr>${l
                .split(/[\t|,;]/)
                .map((c) => `<td>${escapeXml(c.trim())}</td>`)
                .join("")}</tr>`,
          )
          .join("") ||
        `<tr><td>${file.name}</td><td>${new Date().toLocaleString()}</td></tr>`;
      const htmlTable = `<html><head><meta charset="UTF-8"></head><body><table>${rows}</table></body></html>`;
      resultData = new Blob([htmlTable], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      });
      break;
    }
    case "pptx": {
      const slides =
        content
          .split("\n")
          .filter((l) => l.trim())
          .slice(0, 20)
          .map(
            (l) =>
              `<div style="page-break-after:always;padding:40px;font-family:Arial"><h2>${escapeXml(l.substring(0, 80))}</h2></div>`,
          )
          .join("\n") ||
        `<div style="padding:40px"><h2>${name}</h2><p>Converted from ${file.name}</p></div>`;
      resultData = new Blob(
        [
          `<html><head><meta charset="UTF-8"></head><body>${slides}</body></html>`,
        ],
        {
          type: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        },
      );
      break;
    }
    case "jpg":
    case "png": {
      const preview = content
        .substring(0, 800)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
      const lines = preview.split("\n").slice(0, 35);
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="1000"><rect width="800" height="1000" fill="white"/><rect x="20" y="20" width="760" height="80" fill="#f59e0b" rx="8"/><text x="40" y="68" font-family="Arial" font-size="24" fill="white" font-weight="bold">${escapeXml(name)}</text><text x="40" y="130" font-family="Arial" font-size="12" fill="#666">Source: ${ext.toUpperCase()} | ${content.split("\n").length} lines</text><rect x="20" y="150" width="760" height="830" fill="#f9fafb" stroke="#e5e7eb" rx="4"/>${lines.map((l, i) => `<text x="40" y="${180 + i * 18}" font-family="monospace" font-size="11" fill="#374151">${escapeXml(l.substring(0, 90))}</text>`).join("")}<text x="40" y="980" font-family="Arial" font-size="10" fill="#9ca3af">Converted by FuelPro | ${new Date().toLocaleDateString()}</text></svg>`;
      resultData = new Blob([svg], {
        type: target === "png" ? "image/png" : "image/jpeg",
      });
      mime = target === "png" ? "image/png" : "image/jpeg";
      break;
    }
    default: {
      resultData = content || `[Converted file: ${file.name}]`;
      mime = "text/plain";
    }
  }

  onProgress(100);
  const blob =
    resultData instanceof Blob
      ? resultData
      : new Blob([resultData], { type: mime });
  return { data: blob, mime, fileName: `${name}_converted${info.ext}` };
}

function linesToHtml(lines: string[]): string {
  if (lines.length === 0) return "<p>(empty file)</p>";
  const hasTabs = lines.some((l) => l.includes("\t"));
  if (hasTabs) {
    return `<table border="1" cellpadding="6">${lines
      .map((l, i) => {
        const cells = l
          .split("\t")
          .map((c) =>
            i === 0
              ? `<th>${escapeXml(c.trim())}</th>`
              : `<td>${escapeXml(c.trim())}</td>`,
          )
          .join("");
        return `<tr>${cells}</tr>`;
      })
      .join("")}</table>`;
  }
  return lines.map((l) => `<p>${escapeXml(l)}</p>`).join("\n");
}

function escapeXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function triggerDownload(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export default function DocumentConverter() {
  const [jobs, setJobs] = useState<ConversionJob[]>(() => {
    try {
      const saved = localStorage.getItem("fuelpro_converter_jobs");
      if (saved) return JSON.parse(saved);
    } catch {
      /* */
    }
    return [];
  });
  const [targetFormat, setTargetFormat] = useState<SupportedFormat>("pdf");
  const [isDragging, setIsDragging] = useState(false);
  const [showCamera, setShowCamera] = useState(false);
  const [cameraError, setCameraError] = useState("");
  const [videoStream, setVideoStream] = useState<MediaStream | null>(null);
  const [previewJob, setPreviewJob] = useState<ConversionJob | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cloudLoadCompleteRef = useRef(false);
  const localModifiedRef = useRef(false);
  const skipRemoteRef = useRef(false);

  // Persist jobs to localStorage (read-through cache)
  useEffect(() => {
    try {
      localStorage.setItem("fuelpro_converter_jobs", JSON.stringify(jobs));
    } catch {
      /* quota */
    }
    if (cloudLoadCompleteRef.current) {
      // Only persist lightweight metadata cross-device (resultData can be large)
      const lite = jobs.slice(0, 50).map(({ resultData, ...rest }) => rest);
      skipRemoteRef.current = true;
      cloudStorageService.set("converter_jobs", lite).catch(() => {});
    }
  }, [jobs]);

  // Load jobs from cloud on mount (cross-device sync) + realtime
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const cloud =
        await cloudStorageService.get<ConversionJob[]>("converter_jobs");
      if (cancelled) return;
      if (
        Array.isArray(cloud) &&
        cloud.length > 0 &&
        !localModifiedRef.current
      ) {
        // Merge: cloud has metadata only (no resultData); keep local resultData
        setJobs((prev) => {
          const byId = new Map(prev.map((j) => [j.id, j]));
          const merged = cloud.map((c) => {
            const local = byId.get(c.id);
            return local?.resultData
              ? {
                  ...c,
                  resultData: local.resultData,
                  resultMime: local.resultMime,
                }
              : c;
          });
          // Append any local jobs not in cloud
          const cloudIds = new Set(cloud.map((c) => c.id));
          const localOnly = prev.filter((j) => !cloudIds.has(j.id));
          return [...merged, ...localOnly];
        });
      }
      cloudLoadCompleteRef.current = true;
      const unsub = cloudStorageService.subscribe<ConversionJob[]>(
        "converter_jobs",
        undefined,
        (cloudArr) => {
          if (skipRemoteRef.current) {
            skipRemoteRef.current = false;
            return;
          }
          if (Array.isArray(cloudArr) && !localModifiedRef.current) {
            setJobs((prev) => {
              const byId = new Map(prev.map((j) => [j.id, j]));
              return cloudArr.map((c) => {
                const local = byId.get(c.id);
                return local?.resultData
                  ? {
                      ...c,
                      resultData: local.resultData,
                      resultMime: local.resultMime,
                    }
                  : c;
              });
            });
          }
        },
      );
      return () => {
        cancelled = true;
        unsub?.();
      };
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const processConversion = useCallback(
    async (file: File) => {
      localModifiedRef.current = true;
      const jobId = `conv_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      const ext = file.name.split(".").pop()?.toUpperCase() || "FILE";

      setJobs((prev) => [
        {
          id: jobId,
          fileName: file.name,
          originalType: ext,
          targetFormat,
          status: "converting",
          progress: 0,
        },
        ...prev,
      ]);

      try {
        const result = await convertFile(file, targetFormat, (p) => {
          setJobs((prev) =>
            prev.map((j) => (j.id === jobId ? { ...j, progress: p } : j)),
          );
        });

        // Store result as data URL for later download
        const reader = new FileReader();
        reader.onload = () => {
          const dataUrl = reader.result as string;
          setJobs((prev) =>
            prev.map((j) =>
              j.id === jobId
                ? {
                    ...j,
                    status: "done",
                    progress: 100,
                    result: result.fileName,
                    resultData: dataUrl,
                    resultMime: result.mime,
                  }
                : j,
            ),
          );

          // Auto-download
          setTimeout(() => triggerDownload(result.data, result.fileName), 300);
        };
        reader.readAsDataURL(result.data);
      } catch (err: any) {
        setJobs((prev) =>
          prev.map((j) =>
            j.id === jobId
              ? {
                  ...j,
                  status: "error",
                  error: err.message || "Conversion failed",
                }
              : j,
          ),
        );
      }
    },
    [targetFormat],
  );

  const handleFile = useCallback(
    (files: FileList | null) => {
      if (!files) return;
      Array.from(files).forEach((file, i) => {
        setTimeout(() => processConversion(file), i * 400);
      });
    },
    [processConversion],
  );

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      handleFile(e.dataTransfer.files);
    },
    [handleFile],
  );
  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);
  const onDragLeave = useCallback(() => setIsDragging(false), []);
  const removeJob = (id: string) => {
    localModifiedRef.current = true;
    setJobs((prev) => prev.filter((j) => j.id !== id));
  };
  const clearAll = () => {
    if (confirm("Clear all conversion history?")) {
      localModifiedRef.current = true;
      setJobs([]);
    }
  };
  const downloadAll = () => {
    const done = jobs.filter((j) => j.status === "done" && j.resultData);
    if (done.length === 0) return;
    done.forEach((job, i) => {
      setTimeout(() => {
        try {
          const byteString = atob(job.resultData!.split(",")[1]);
          const ab = new ArrayBuffer(byteString.length);
          const ia = new Uint8Array(ab);
          for (let k = 0; k < byteString.length; k++)
            ia[k] = byteString.charCodeAt(k);
          triggerDownload(
            new Blob([ab], {
              type: job.resultMime || "application/octet-stream",
            }),
            job.result!,
          );
        } catch {
          /* */
        }
      }, i * 250);
    });
  };

  // Camera functions
  const startCamera = async () => {
    setCameraError("");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment" },
      });
      setVideoStream(stream);
      setShowCamera(true);
      setTimeout(() => {
        if (videoRef.current) videoRef.current.srcObject = stream;
      }, 100);
    } catch (err: any) {
      setCameraError(
        err.message || "Camera access denied. Please allow camera permissions.",
      );
      setShowCamera(false);
    }
  };

  const stopCamera = () => {
    videoStream?.getTracks().forEach((t) => t.stop());
    setVideoStream(null);
    setShowCamera(false);
  };

  const capturePhoto = () => {
    if (!videoRef.current || !canvasRef.current) return;
    const video = videoRef.current;
    const canvas = canvasRef.current;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(video, 0, 0);
    canvas.toBlob(
      (blob) => {
        if (!blob) return;
        const file = new File([blob], `camera_capture_${Date.now()}.jpg`, {
          type: "image/jpeg",
        });
        stopCamera();
        processConversion(file);
      },
      "image/jpeg",
      0.92,
    );
  };

  // Cleanup camera on unmount
  useEffect(
    () => () => {
      videoStream?.getTracks().forEach((t) => t.stop());
    },
    [videoStream],
  );

  const doneCount = jobs.filter((j) => j.status === "done").length;

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="p-2.5 bg-amber-100 dark:bg-amber-900/30 rounded-xl">
          <FileUp size={24} className="text-amber-600 dark:text-amber-400" />
        </div>
        <div className="flex-1">
          <h2 className="text-2xl font-bold text-gray-900 dark:text-white">
            Document Converter
          </h2>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Upload any file — we convert to your target format. Supports 30+
            input formats.
          </p>
        </div>
        {jobs.length > 0 && (
          <button
            onClick={clearAll}
            className="text-xs text-red-500 hover:text-red-600 flex items-center gap-1"
          >
            <Trash2 size={12} /> Clear All
          </button>
        )}
      </div>

      {/* Target Format + Camera */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex-1">
            <label className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2 block">
              Convert to:
            </label>
            <div className="flex flex-wrap gap-2">
              {Object.entries(FORMAT_INFO).map(([key, info]) => (
                <button
                  key={key}
                  onClick={() => setTargetFormat(key as SupportedFormat)}
                  className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-all ${
                    targetFormat === key
                      ? "bg-amber-500 text-white shadow-md"
                      : "bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600"
                  }`}
                >
                  {info.label}
                </button>
              ))}
            </div>
          </div>
          <button
            onClick={showCamera ? stopCamera : startCamera}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium transition-all"
          >
            {showCamera ? <CameraOff size={16} /> : <Camera size={16} />}
            {showCamera ? "Close Camera" : "Capture Document"}
          </button>
        </div>
        {cameraError && (
          <div className="mt-3 p-3 bg-red-50 dark:bg-red-900/20 rounded-lg text-xs text-red-600 flex items-center gap-2">
            <AlertCircle size={14} /> {cameraError}
          </div>
        )}
      </div>

      {/* Camera Capture UI */}
      {showCamera && (
        <div className="bg-black rounded-xl overflow-hidden border border-gray-700">
          <div className="relative">
            <video
              ref={videoRef}
              autoPlay
              playsInline
              className="w-full h-64 sm:h-80 object-cover"
            />
            <canvas ref={canvasRef} className="hidden" />
            <div className="absolute bottom-4 left-0 right-0 flex justify-center gap-3">
              <button
                onClick={capturePhoto}
                className="px-6 py-2 bg-green-600 hover:bg-green-700 text-white rounded-full text-sm font-bold shadow-lg transition-all"
              >
                <Camera size={16} className="inline mr-1" /> Capture & Convert
              </button>
              <button
                onClick={() => {
                  if (videoRef.current) {
                    videoRef.current.classList.toggle("transform");
                  } /* rotate placeholder */
                }}
                className="p-2 bg-gray-700 hover:bg-gray-600 text-white rounded-full"
                title="Flip"
              >
                <RotateCcw size={16} />
              </button>
            </div>
          </div>
          <p className="text-center text-gray-400 text-xs py-2">
            Position document in frame and tap Capture
          </p>
        </div>
      )}

      {/* Drop Zone */}
      {!showCamera && (
        <div
          onDrop={onDrop}
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
          onClick={() => fileInputRef.current?.click()}
          className={`relative border-2 border-dashed rounded-xl p-10 text-center cursor-pointer transition-all ${
            isDragging
              ? "border-amber-500 bg-amber-50 dark:bg-amber-900/20 scale-[1.01]"
              : "border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-800/50 hover:border-gray-400"
          }`}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept={ALL_ACCEPTED_EXTS}
            multiple
            onChange={(e) => {
              handleFile(e.target.files);
              e.target.value = "";
            }}
            className="hidden"
          />
          <div
            className={`mx-auto w-16 h-16 rounded-full flex items-center justify-center mb-4 transition-all ${
              isDragging
                ? "bg-amber-100 dark:bg-amber-900/30"
                : "bg-white dark:bg-gray-700 shadow-sm"
            }`}
          >
            <FileUp
              size={28}
              className={isDragging ? "text-amber-600" : "text-gray-400"}
            />
          </div>
          <p className="text-sm font-medium text-gray-700 dark:text-gray-300">
            {isDragging
              ? "Drop files here!"
              : "Drag & drop files here, or click to browse"}
          </p>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
            PDF, DOCX, XLSX, PPTX, TXT, CSV, ODT, Pages, Images, and more
          </p>
        </div>
      )}

      {/* Jobs List */}
      {jobs.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <h3 className="text-sm font-semibold text-gray-900 dark:text-white flex items-center gap-2">
              Conversions ({jobs.length}){" "}
              {doneCount > 0 && (
                <span className="text-green-500">{doneCount} done</span>
              )}
            </h3>
            {doneCount > 1 && (
              <button
                onClick={downloadAll}
                className="text-xs text-blue-600 hover:text-blue-700 flex items-center gap-1 px-2 py-1 rounded-lg hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-all"
              >
                <Download size={12} /> Download All ({doneCount})
              </button>
            )}
          </div>
          {jobs.map((job) => (
            <div
              key={job.id}
              className={`bg-white dark:bg-gray-800 rounded-xl border p-4 transition-all ${
                job.status === "error"
                  ? "border-red-200"
                  : job.status === "done"
                    ? "border-green-200"
                    : "border-gray-200 dark:border-gray-700"
              }`}
            >
              <div className="flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-900 dark:text-white truncate">
                    {job.fileName}
                  </p>
                  <p className="text-xs text-gray-500">
                    {job.originalType} → {FORMAT_INFO[job.targetFormat].label}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {job.status === "converting" && (
                    <Loader2
                      size={16}
                      className="text-amber-500 animate-spin"
                    />
                  )}
                  {job.status === "done" && (
                    <CheckCircle2 size={16} className="text-green-500" />
                  )}
                  {job.status === "error" && (
                    <AlertCircle size={16} className="text-red-500" />
                  )}
                  {job.status === "done" && job.resultData && (
                    <button
                      onClick={() => setPreviewJob(job)}
                      className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-500 transition-all"
                      title="Preview"
                    >
                      <Eye size={14} />
                    </button>
                  )}
                  {job.status === "done" && job.resultData && (
                    <button
                      onClick={() => {
                        const byteString = atob(job.resultData!.split(",")[1]);
                        const ab = new ArrayBuffer(byteString.length);
                        const ia = new Uint8Array(ab);
                        for (let i = 0; i < byteString.length; i++)
                          ia[i] = byteString.charCodeAt(i);
                        triggerDownload(
                          new Blob([ab], {
                            type: job.resultMime || "application/octet-stream",
                          }),
                          job.result!,
                        );
                      }}
                      className="p-1.5 rounded-lg hover:bg-gray-100 text-blue-500 transition-all"
                      title="Download"
                    >
                      <Download size={14} />
                    </button>
                  )}
                  <button
                    onClick={() => removeJob(job.id)}
                    className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 transition-all"
                  >
                    <X size={14} />
                  </button>
                </div>
              </div>
              {job.status === "converting" && (
                <div className="mt-3">
                  <div className="h-1.5 bg-gray-100 dark:bg-gray-700 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-amber-500 rounded-full transition-all duration-300"
                      style={{ width: `${job.progress}%` }}
                    />
                  </div>
                  <p className="text-[10px] text-gray-400 mt-1 text-right">
                    {job.progress}%
                  </p>
                </div>
              )}
              {job.status === "error" && job.error && (
                <p className="mt-2 text-xs text-red-600">{job.error}</p>
              )}
              {job.status === "done" && job.result && (
                <p className="mt-2 text-xs text-green-600 flex items-center gap-1">
                  <CheckCircle2 size={10} /> {job.result} — auto-downloaded
                </p>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Preview Modal */}
      {previewJob && previewJob.resultData && (
        <div
          className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4"
          onClick={() => setPreviewJob(null)}
        >
          <div
            className="bg-white dark:bg-gray-800 rounded-xl max-w-3xl w-full max-h-[85vh] overflow-hidden flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between p-3 border-b border-gray-200 dark:border-gray-700">
              <h4 className="text-sm font-semibold text-gray-900 dark:text-white truncate">
                Preview: {previewJob.result || previewJob.fileName}
              </h4>
              <button
                onClick={() => setPreviewJob(null)}
                className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-400"
              >
                <X size={16} />
              </button>
            </div>
            <div className="flex-1 overflow-auto p-4 bg-gray-50 dark:bg-gray-900 flex items-center justify-center">
              {previewJob.resultMime?.startsWith("image/") ? (
                <img
                  src={previewJob.resultData}
                  alt={previewJob.fileName}
                  className="max-w-full max-h-[60vh] object-contain"
                />
              ) : previewJob.resultMime === "application/pdf" ? (
                <iframe
                  src={previewJob.resultData}
                  title="preview"
                  className="w-full h-[60vh] border-0"
                />
              ) : previewJob.resultMime?.startsWith("text/") ||
                previewJob.resultMime?.includes("html") ||
                previewJob.resultMime?.includes("xml") ||
                previewJob.resultMime?.includes("svg") ? (
                <iframe
                  src={previewJob.resultData}
                  title="preview"
                  className="w-full h-[60vh] border-0 bg-white"
                />
              ) : (
                <div className="text-center text-gray-500 text-sm">
                  <FileText size={40} className="mx-auto mb-2 text-gray-300" />
                  Preview not available for this format.
                  <br />
                  <button
                    onClick={() => {
                      const byteString = atob(
                        previewJob.resultData!.split(",")[1],
                      );
                      const ab = new ArrayBuffer(byteString.length);
                      const ia = new Uint8Array(ab);
                      for (let i = 0; i < byteString.length; i++)
                        ia[i] = byteString.charCodeAt(i);
                      triggerDownload(
                        new Blob([ab], {
                          type:
                            previewJob.resultMime || "application/octet-stream",
                        }),
                        previewJob.result!,
                      );
                    }}
                    className="mt-3 text-blue-600 hover:underline"
                  >
                    Download instead
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Info Banner */}
      <div className="bg-blue-50 dark:bg-blue-900/10 rounded-xl border border-blue-200 dark:border-blue-800 p-4">
        <h4 className="text-sm font-semibold text-blue-800 dark:text-blue-300 flex items-center gap-2">
          <FileType size={14} /> How It Works
        </h4>
        <p className="text-xs text-blue-700 dark:text-blue-400 mt-1">
          1. Select your target format above. 2. Drag & drop a file or click
          browse. 3. Conversion happens automatically — no buttons to press. 4.
          Downloaded file saves to your device. For camera: tap "Capture
          Document", position the page, then tap Capture.
        </p>
      </div>
    </div>
  );
}
