import geminiHandler from "./gemini-ocr";

/**
 * Compatibility adapter for Vercel's Node response implementation.
 *
 * The legacy OCR handler calls res.setHeaders() with a plain object. Vercel's
 * current runtime exposes setHeaders() with Headers/Map semantics, so the
 * request can fail before JSON is returned. Normalize the legacy call at the
 * route boundary instead of duplicating the OCR pipeline.
 */
export default async function handler(req: any, res: any) {
  const originalSetHeaders = res.setHeaders;

  if (typeof originalSetHeaders === "function") {
    res.setHeaders = (headers: unknown) => {
      if (headers instanceof Headers || headers instanceof Map) {
        return originalSetHeaders.call(res, headers);
      }

      if (headers && typeof headers === "object") {
        for (const [name, value] of Object.entries(headers as Record<string, unknown>)) {
          if (value !== undefined && value !== null) {
            res.setHeader(name, String(value));
          }
        }
        return res;
      }

      return res;
    };
  }

  try {
    return await geminiHandler(req, res);
  } finally {
    if (typeof originalSetHeaders === "function") {
      res.setHeaders = originalSetHeaders;
    }
  }
}
