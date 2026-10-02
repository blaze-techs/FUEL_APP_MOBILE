type RequestLike = {
  method?: string;
  headers: Record<string, string | string[] | undefined>;
  body?: unknown;
};
type ResponseLike = {
  status: (code: number) => ResponseLike;
  setHeaders: (headers: Record<string, string>) => ResponseLike;
  setHeader: (name: string, value: string) => ResponseLike;
  json: (body: unknown) => ResponseLike;
  send: (body: string) => ResponseLike;
  end: () => ResponseLike;
};

const MAX_BYTES = 4_500_000;
const MAX_BASE64_CHARS = 6_100_000;
const ALLOWED_MIME = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
  "application/pdf",
]);
const GENERIC_SCHEMA = {
  type: "object",
  properties: {
    text: { type: "string" },
    confidence: { type: "string", enum: ["high", "medium", "low"] },
    notes: { type: "array", items: { type: "string" } },
  },
  required: ["text", "confidence", "notes"],
};
const FUEL_SCHEMA = {
  type: "object",
  properties: {
    date: { type: ["string", "null"] },
    shift: { type: ["string", "null"] },
    confidence: { type: "string", enum: ["high", "medium", "low"] },
    pumps: {
      type: "array",
      items: {
        type: "object",
        properties: {
          visiblePumpId: { type: ["string", "null"] },
          fuelType: { type: ["string", "null"] },
          openingReading: { type: ["number", "null"] },
          closingReading: { type: ["number", "null"] },
          openingLitres: { type: ["number", "null"] },
          closingLitres: { type: ["number", "null"] },
          writtenSalesAmount: { type: ["number", "null"] },
          writtenSalesLitres: { type: ["number", "null"] },
          evidence: { type: "string" },
          confidence: { type: "string", enum: ["high", "medium", "low"] },
        },
        required: [
          "visiblePumpId",
          "fuelType",
          "openingReading",
          "closingReading",
          "openingLitres",
          "closingLitres",
          "writtenSalesAmount",
          "writtenSalesLitres",
          "evidence",
          "confidence",
        ],
      },
    },
    expenses: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          amount: { type: ["number", "null"] },
          confidence: { type: "string", enum: ["high", "medium", "low"] },
        },
        required: ["name", "amount", "confidence"],
      },
    },
    tillAmount: { type: ["number", "null"] },
    cashAmount: { type: ["number", "null"] },
    totalSalesWritten: { type: ["number", "null"] },
    notes: { type: "array", items: { type: "string" } },
  },
  required: [
    "date",
    "shift",
    "confidence",
    "pumps",
    "expenses",
    "tillAmount",
    "cashAmount",
    "totalSalesWritten",
    "notes",
  ],
};
const MPESA_SCHEMA = {
  type: "object",
  properties: {
    statementName: { type: ["string", "null"] },
    accountOrTill: { type: ["string", "null"] },
    confidence: { type: "string", enum: ["high", "medium", "low"] },
    transactions: {
      type: "array",
      items: {
        type: "object",
        properties: {
          date: { type: ["string", "null"] },
          time: { type: ["string", "null"] },
          receipt: { type: ["string", "null"] },
          details: { type: "string" },
          paidIn: { type: ["number", "null"] },
          balance: { type: ["number", "null"] },
          transactionType: { type: "string" },
          includeAsInflow: { type: "boolean" },
          exclusionReason: { type: ["string", "null"] },
          confidence: { type: "string", enum: ["high", "medium", "low"] },
          evidence: { type: "string" },
        },
        required: [
          "date",
          "time",
          "receipt",
          "details",
          "paidIn",
          "balance",
          "transactionType",
          "includeAsInflow",
          "exclusionReason",
          "confidence",
          "evidence",
        ],
      },
    },
    notes: { type: "array", items: { type: "string" } },
  },
  required: [
    "statementName",
    "accountOrTill",
    "confidence",
    "transactions",
    "notes",
  ],
};
function cors(origin?: string): Record<string, string> {
  const allowed =
    !origin ||
    origin === "https://fuel-app-mobile.pages.dev" ||
    origin === "https://fuel-app-mobile.vercel.app" ||
    origin.startsWith("http://localhost:") ||
    (origin.includes("fuel-app-mobile-") && origin.endsWith(".vercel.app"));
  return {
    "Access-Control-Allow-Origin": allowed
      ? origin || "*"
      : "https://fuel-app-mobile.pages.dev",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    Vary: "Origin",
  };
}
function json(
  res: ResponseLike,
  status: number,
  body: unknown,
  origin?: string,
) {
  return res.status(status).setHeaders(cors(origin)).json(body);
}
async function requireSupabaseUser(req: RequestLike): Promise<boolean> {
  const auth = req.headers.authorization;
  const token = String(Array.isArray(auth) ? auth[0] || "" : auth || "")
    .replace(/^Bearer\s+/i, "")
    .trim();
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
  const key =
    process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || "";
  if (!token || !url || !key) return false;
  try {
    const r = await fetch(`${url.replace(/\/$/, "")}/auth/v1/user`, {
      headers: { apikey: key, Authorization: `Bearer ${token}` },
    });
    return r.ok;
  } catch {
    return false;
  }
}
function promptFor(task: string, context?: Record<string, unknown>) {
  const ctx = context ? JSON.stringify(context).slice(0, 30000) : "{}";
  if (task === "generic_document")
    return {
      schema: GENERIC_SCHEMA,
      text: `Visually OCR the ENTIRE supplied document/image. Preserve all visible text, numbers, dates, receipt codes, table rows and handwritten annotations in reading order. Do not summarize or infer. Do not correct ambiguous characters. If unreadable, retain the best literal transcription and mention the uncertainty. Return ONLY JSON. Context: ${ctx}`,
    };
  if (task === "mpesa_statement")
    return {
      schema: MPESA_SCHEMA,
      text: `You are FuelPro's precision financial-document vision extractor. Visually inspect the ENTIRE supplied M-PESA statement image/PDF, including multiple pages, tables, faint text and annotations. Extract every visibly present transaction. Preserve dates, times, receipt codes, customer/phone details, Paid In and Balance exactly as seen. Set includeAsInflow=true ONLY for genuine customer/merchant-payment inflows. Exclude loans, charges, fees, own-account transfers, reversals and other non-revenue movements, with a reason. Never invent missing values: use null and lower confidence when unreadable. If page overlap duplicates a transaction, keep one and note it. Return ONLY JSON. Context: ${ctx}`,
    };
  return {
    schema: FUEL_SCHEMA,
    text: `You are FuelPro's precision fuel-sales vision/OCR specialist. Visually inspect the ENTIRE supplied handwritten or printed fuel sales sheet. Read every number from the document itself; never guess from row order, common prices or prior examples. A pump block normally contains opening KSh totalizer, opening litres, closing KSh totalizer, closing litres and possibly handwritten sales. Preserve every visible number exactly. Calculate meter deltas internally and compare with written sales. If unclear, return null instead of inventing a digit. Do not create absent pumps. Only return fuel type or pump ID when explicitly visible or uniquely supported by context. A page with any unresolved arithmetic discrepancy must not be high confidence. Missing date/shift may be medium confidence. Never silently correct handwritten values; report discrepancies in notes. Return ONLY JSON. Context: ${ctx}`,
  };
}

export default async function handler(req: RequestLike, res: ResponseLike) {
  const originHeader = req.headers.origin;
  const origin = Array.isArray(originHeader) ? originHeader[0] : originHeader;
  if (req.method === "OPTIONS")
    return res.status(204).setHeaders(cors(origin)).end();
  if (req.method !== "POST")
    return json(res, 405, { success: false, error: "POST required" }, origin);
  if (!(await requireSupabaseUser(req)))
    return json(
      res,
      401,
      {
        success: false,
        error:
          "Authenticated FuelPro session required for Gemini document processing.",
      },
      origin,
    );
  const apiKey =
    process.env.GEMINI_API_KEY || process.env.VITE_GEMINI_API_KEY || "";
  if (!apiKey)
    return json(
      res,
      503,
      {
        success: false,
        error:
          "Gemini is not configured on the server. Set GEMINI_API_KEY in Vercel/Cloudflare secrets.",
      },
      origin,
    );
  const body =
    req.body && typeof req.body === "object"
      ? (req.body as Record<string, unknown>)
      : {};
  const requestedModel = process.env.GEMINI_MODEL || "gemini-3.8-flash";
  if (Array.isArray(body.contents)) {
    const generationConfig = {
      ...(body.generationConfig && typeof body.generationConfig === "object"
        ? (body.generationConfig as Record<string, unknown>)
        : {}),
    };
    delete generationConfig.temperature;
    delete generationConfig.topP;
    delete generationConfig.topK;
    delete generationConfig.candidateCount;
    generationConfig.responseMimeType = "application/json";
    const callText = (model: string, config: Record<string, unknown>) =>
      fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-goog-api-key": apiKey,
          },
          body: JSON.stringify({
            contents: body.contents,
            generationConfig: config,
          }),
        },
      );
    try {
      let model = requestedModel;
      let upstream = await callText(model, generationConfig);
      if (upstream.status === 404 && model !== "gemini-2.5-flash") {
        model = "gemini-2.5-flash";
        upstream = await callText(model, {
          ...generationConfig,
          thinkingConfig: { thinkingBudget: 8192 },
        });
      }
      const raw = await upstream.text();
      if (!upstream.ok)
        return json(
          res,
          502,
          {
            success: false,
            error: `Gemini upstream ${upstream.status}`,
            detail: raw.slice(0, 1200),
          },
          origin,
        );
      res.status(200).setHeaders(cors(origin));
      res.setHeader("Content-Type", "application/json");
      return res.send(raw);
    } catch (error) {
      return json(
        res,
        502,
        {
          success: false,
          error: error instanceof Error ? error.message : String(error),
        },
        origin,
      );
    }
  }
  const mimeType = String(body.mimeType || "");
  const data = String(body.data || "");
  const task = String(body.task || "generic_document");
  const context =
    body.context && typeof body.context === "object"
      ? (body.context as Record<string, unknown>)
      : undefined;
  if (!ALLOWED_MIME.has(mimeType))
    return json(
      res,
      400,
      { success: false, error: `Unsupported MIME type: ${mimeType}` },
      origin,
    );
  if (
    !data ||
    data.length > MAX_BASE64_CHARS ||
    Math.floor((data.length * 3) / 4) > MAX_BYTES
  )
    return json(
      res,
      413,
      { success: false, error: "Document exceeds the AI proxy size limit." },
      origin,
    );
  if (!["generic_document", "fuel_sales", "mpesa_statement"].includes(task))
    return json(
      res,
      400,
      { success: false, error: "Unsupported OCR task." },
      origin,
    );
  const { text, schema } = promptFor(task, context);
  const callGemini = (
    model: string,
    generationConfig: Record<string, unknown>,
  ) =>
    fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": apiKey,
        },
        body: JSON.stringify({
          systemInstruction: {
            parts: [
              {
                text: "You are a precision financial OCR system. Never hallucinate numbers; use null when uncertain.",
              },
            ],
          },
          contents: [
            {
              role: "user",
              parts: [{ text }, { inlineData: { mimeType, data } }],
            },
          ],
          generationConfig,
        }),
      },
    );
  try {
    let model = requestedModel;
    let upstream = await callGemini(model, {
      responseMimeType: "application/json",
      responseSchema: schema,
      thinkingConfig: { thinkingLevel: "medium" },
    });
    if (upstream.status === 404 && model !== "gemini-2.5-flash") {
      model = "gemini-2.5-flash";
      upstream = await callGemini(model, {
        responseMimeType: "application/json",
        responseSchema: schema,
        thinkingConfig: { thinkingBudget: 8192 },
      });
    }
    const raw = await upstream.text();
    if (!upstream.ok)
      return json(
        res,
        502,
        {
          success: false,
          error: `Gemini upstream ${upstream.status}`,
          detail: raw.slice(0, 1200),
        },
        origin,
      );
    const response = JSON.parse(raw);
    const output =
      response.candidates?.[0]?.content?.parts
        ?.map((p: { text?: string }) => p.text || "")
        .join("") || "";
    if (!output)
      return json(
        res,
        502,
        { success: false, error: "Gemini returned no structured OCR result." },
        origin,
      );
    let extracted: unknown;
    try {
      extracted = JSON.parse(output);
    } catch {
      return json(
        res,
        502,
        {
          success: false,
          error: "Gemini returned invalid structured OCR JSON.",
        },
        origin,
      );
    }
    return json(
      res,
      200,
      { success: true, provider: "gemini", model, task, extracted },
      origin,
    );
  } catch (error) {
    return json(
      res,
      502,
      {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      },
      origin,
    );
  }
}
