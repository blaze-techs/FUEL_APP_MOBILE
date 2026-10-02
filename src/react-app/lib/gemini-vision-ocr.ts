export type GeminiOcrTask = "fuel_sales" | "mpesa_statement";

export interface GeminiFuelPump {
  visiblePumpId: string | null;
  fuelType: string | null;
  openingReading: number | null;
  closingReading: number | null;
  openingLitres: number | null;
  closingLitres: number | null;
  writtenSalesAmount: number | null;
  writtenSalesLitres: number | null;
  evidence: string;
  confidence: "high" | "medium" | "low";
}

export interface GeminiFuelResult {
  date: string | null;
  shift: string | null;
  confidence: "high" | "medium" | "low";
  pumps: GeminiFuelPump[];
  expenses: Array<{ name: string; amount: number | null; confidence: "high" | "medium" | "low" }>;
  tillAmount: number | null;
  cashAmount: number | null;
  totalSalesWritten: number | null;
  notes: string[];
}

export interface GeminiMpesaTransaction {
  date: string | null;
  time: string | null;
  receipt: string | null;
  details: string;
  paidIn: number | null;
  balance: number | null;
  transactionType: string;
  includeAsInflow: boolean;
  exclusionReason: string | null;
  confidence: "high" | "medium" | "low";
  evidence: string;
}

export interface GeminiMpesaResult {
  statementName: string | null;
  accountOrTill: string | null;
  confidence: "high" | "medium" | "low";
  transactions: GeminiMpesaTransaction[];
  notes: string[];
}

async function fileToBase64(file: File): Promise<{ mimeType: string; data: string }> {
  let source = file;
  // Keep browser→server payloads below serverless request limits. JPEG/PNG
  // photos are compressed before Gemini; PDFs are never modified because doing
  // so in-browser can destroy selectable text or document fidelity.
  if (file.type.startsWith("image/")) {
    source = await compressImage(file);
  }
  const buffer = await source.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, Math.min(i + chunk, bytes.length)));
  }
  return { mimeType: source.type || file.type || "application/octet-stream", data: btoa(binary) };
}

async function compressImage(file: File): Promise<File> {
  const MAX_BYTES = 3_200_000;
  if (file.size <= MAX_BYTES && !/heic|heif/i.test(file.type)) return file;
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  const maxDimension = 2400;
  const scale = Math.min(1, maxDimension / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Unable to prepare image for Gemini OCR.");
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.9));
  if (!blob) throw new Error("Unable to encode image for Gemini OCR.");
  return new File([blob], file.name.replace(/\.[^.]+$/, ".jpg"), { type: "image/jpeg", lastModified: file.lastModified });
}

function getFuelContext(context: Record<string, unknown> | undefined): Record<string, unknown> {
  return context || {};
}

async function callGemini<T>(file: File, task: GeminiOcrTask, context?: Record<string, unknown>, accessToken?: string | null): Promise<T> {
  const { mimeType, data } = await fileToBase64(file);
  const response = await fetch("/api/gemini-ocr", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
    },
    body: JSON.stringify({ mimeType, data, task, context }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload?.success) {
    throw new Error(String(payload?.error || `Gemini OCR request failed (${response.status})`));
  }
  return payload.extracted as T;
}

export async function geminiExtractFuelSales(
  file: File,
  context?: Record<string, unknown>,
  accessToken?: string | null,
): Promise<GeminiFuelResult> {
  return callGemini<GeminiFuelResult>(file, "fuel_sales", getFuelContext(context), accessToken);
}

export async function geminiExtractMpesaStatement(
  file: File,
  context?: Record<string, unknown>,
  accessToken?: string | null,
): Promise<GeminiMpesaResult> {
  return callGemini<GeminiMpesaResult>(file, "mpesa_statement", context, accessToken);
}

export function fuelGeminiResultToSalesText(result: GeminiFuelResult): string {
  const lines: string[] = [];
  if (result.date) lines.push(`Date: ${result.date}`);
  if (result.shift) lines.push(`Shift: ${result.shift}`);
  for (const p of result.pumps) {
    const values = [p.openingReading, p.openingLitres, p.closingReading, p.closingLitres, p.writtenSalesAmount, p.writtenSalesLitres];
    if (values.every((v) => v === null)) continue;
    lines.push([p.visiblePumpId || "Pump", p.fuelType || "", ...values.map((v) => v == null ? "" : String(v))].join(" | "));
  }
  if (result.totalSalesWritten != null) lines.push(`Total Sales: ${result.totalSalesWritten}`);
  if (result.tillAmount != null) lines.push(`Till: ${result.tillAmount}`);
  if (result.cashAmount != null) lines.push(`Cash: ${result.cashAmount}`);
  return lines.join("\n");
}
