interface Env { [key: string]: unknown; }

const UPSTREAM = "https://fuel-app-mobile.vercel.app/api/gemini-ocr";
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export const onRequestOptions: PagesFunction<Env> = async () =>
  new Response(null, { status: 204, headers: CORS });

export const onRequestPost: PagesFunction<Env> = async (context) => {
  try {
    const authorization = context.request.headers.get("authorization") || "";
    const body = await context.request.text();
    if (!body || body.length > 6_100_000) {
      return new Response(JSON.stringify({ success: false, error: "Document is too large for Gemini OCR." }), { status: 413, headers: { ...CORS, "Content-Type": "application/json" } });
    }
    const upstream = await fetch(UPSTREAM, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(authorization ? { Authorization: authorization } : {}),
      },
      body,
    });
    const text = await upstream.text();
    return new Response(text, { status: upstream.status, headers: { ...CORS, "Content-Type": "application/json" } });
  } catch (error) {
    return new Response(JSON.stringify({ success: false, error: `Gemini OCR relay failed: ${(error as Error).message}` }), { status: 502, headers: { ...CORS, "Content-Type": "application/json" } });
  }
};
