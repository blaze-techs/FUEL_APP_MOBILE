import type { ComplianceDocument } from "./compliance-documents";
import {
  ocrImage as ocrImageShared,
  ocrPdf as ocrPdfShared,
  renderPdfPagesForOcr as renderPdfPagesForOcrShared,
  extractPdfText as extractPdfTextShared,
} from "./ocr-service";

/**
 * Best-effort extraction of compliance document fields (name, permit type,
 * issuer, issuer email, issue/expiry dates, reference number) from an
 * uploaded file — so an uploaded permit auto-feeds the empty form fields.
 *
 * Extraction pipeline:
 *   1. Text PDFs  → parsed locally with pdfjs-dist (already bundled).
 *   2. Scanned PDFs & images → VISUAL analysis: pages/photo are rendered to
 *      canvas and read with on-device OCR (tesseract.js, fully open-source;
 *      worker/wasm/language assets are served same-origin from /tessdata so
 *      the site CSP is never touched). No data leaves the device.
 *   3. Filename heuristics fill whatever is still missing.
 */

export type ExtractionMethod = "pdf-text" | "ocr" | "filename" | "none";

export interface ExtractedComplianceFields {
  name?: string;
  permitType?: string;
  issuer?: string;
  issuerEmail?: string;
  issueDate?: string; // ISO yyyy-mm-dd
  expiryDate?: string; // ISO yyyy-mm-dd
  /** Licence / permit / certificate reference found in the text. */
  reference?: string;
  /** How the fields were obtained (for the UI to explain what happened). */
  method?: ExtractionMethod;
}

// ── date helpers ────────────────────────────────────────────────────────────

const MONTHS: Record<string, number> = {
  jan: 1,
  january: 1,
  feb: 2,
  february: 2,
  mar: 3,
  march: 3,
  apr: 4,
  april: 4,
  may: 5,
  jun: 6,
  june: 6,
  jul: 7,
  july: 7,
  aug: 8,
  august: 8,
  sep: 9,
  sept: 9,
  september: 9,
  oct: 10,
  october: 10,
  nov: 11,
  november: 11,
  dec: 12,
  december: 12,
};

function iso(y: number, m: number, d: number): string | undefined {
  if (y < 1990 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31)
    return undefined;
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** Parse a date written in almost any common format → ISO, or undefined. */
export function parseDateToken(raw: string): string | undefined {
  const s = raw
    .trim()
    .replace(/(\d+)(st|nd|rd|th)/gi, "$1")
    // common OCR confusions between digits: 31-)2-2028 → 31-12-2028
    .replace(/(?<=[\d\-/.])\)(?=\d)/g, "1")
    .replace(/(?<=[\d\-/.])[lI](?=\d)/g, "1")
    // OCR renders date separators as colons (sometimes mixed):
    // 16:01:2025, 16:01 2025, 16:03-2025 → 16/01/2025
    .replace(/(\d{1,2})\s*[:.]\s*(\d{1,2})\s*[:.]\s*(\d{4})/g, "$1/$2/$3")
    .replace(/(\d{1,2})\s*[:.]\s*(\d{1,2})\s+(\d{4})\b/g, "$1/$2/$3")
    .replace(/(\d{1,2})\s*[:.]\s*(\d{1,2})\s*[-/]\s*(\d{4})/g, "$1/$2/$3");
  // "14 day of May 2025" (Kenyan legal phrasing "this 14th day of May 2025")
  let m = s.match(/(\d{1,2})\s+day\s+of\s+([A-Za-z]{3,9})\s*,?\s*(\d{4})/i);
  if (m && MONTHS[m[2].toLowerCase()])
    return iso(+m[3], MONTHS[m[2].toLowerCase()], +m[1]);
  // 12 March 2026 / March 12, 2026
  m = s.match(/(\d{1,2})\s+([A-Za-z]{3,9})\s*,?\s*(\d{4})/);
  if (m && MONTHS[m[2].toLowerCase()])
    return iso(+m[3], MONTHS[m[2].toLowerCase()], +m[1]);
  m = s.match(/([A-Za-z]{3,9})\s+(\d{1,2})\s*,?\s*(\d{4})/);
  if (m && MONTHS[m[1].toLowerCase()])
    return iso(+m[3], MONTHS[m[1].toLowerCase()], +m[2]);
  // 2026-03-12 (ISO) and 2025/10/01 (NTSA-style)
  m = s.match(/(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (m) return iso(+m[1], +m[2], +m[3]);
  // 12/03/2026 or 03/12/2026 — ambiguous; prefer day-first when d > 12
  m = s.match(/(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})/);
  if (m) {
    const a = +m[1],
      b = +m[2],
      y = +m[3];
    if (a > 12) return iso(y, b, a); // clearly day-first
    if (b > 12) return iso(y, a, b); // clearly month-first
    return iso(y, b, a); // default day-first (most non-US documents)
  }
  // OCR fused day+month: "2006/2025" → 20/06/2025 (validated via iso()).
  m = s.match(/(?<!\d)(\d{2})(\d{2})[-/.](\d{4})(?!\d)/);
  if (m) return iso(+m[3], +m[2], +m[1]);
  return undefined;
}

// ── text extraction (native PDF text layer) ─────────────────────────────────

export async function extractTextFromPdf(file: File | Blob): Promise<string> {
  return extractPdfTextShared(file, 5);
}

// ── visual analysis (OCR) for scanned PDFs & images ─────────────────────────
// Canonical implementation lives in ./ocr-service (shared with every other
// upload/scan flow in the app); these keep the original export signatures.

/** Render up to `maxPages` of a PDF to white-backed canvases (for OCR). */
export async function renderPdfPagesForOcr(
  file: File | Blob,
  maxPages = 2,
): Promise<HTMLCanvasElement[]> {
  return renderPdfPagesForOcrShared(file, maxPages);
}

/**
 * Visually analyze a scanned PDF: renders pages to canvas and OCRs them.
 * Returns the recognized text ("" on failure — never throws).
 */
export async function ocrCompliancePdf(
  file: File | Blob,
  onProgress?: (progress: number) => void,
): Promise<string> {
  return ocrPdfShared(file, {
    maxPages: 2,
    onProgress: (p) => onProgress?.(p.progress),
  });
}

/**
 * Visually analyze an image (jpg/png/webp scan or photo of a permit).
 * Returns the recognized text ("" on failure — never throws).
 */
export async function ocrComplianceImage(
  file: File | Blob,
  onProgress?: (progress: number) => void,
): Promise<string> {
  return ocrImageShared(file, (p) => onProgress?.(p.progress));
}

// ── field extraction from raw text ──────────────────────────────────────────

const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/;

/**
 * Strip scanner watermarks and OCR noise that would otherwise end up as the
 * document name ("CamScanner" was exactly that bug).
 */
export function stripScanNoise(text: string): string {
  return text
    .replace(/cam\s*scanner/gi, " ")
    .replace(/scanned\s+(?:with|by)\s+\S+/gi, " ");
}

/** All dates in the text, in order of appearance (deduped). */
function allDateMatches(rawText: string): { index: number; iso: string }[] {
  // Pre-normalize common digit OCR confusions so the matchers see clean text.
  const text = rawText
    .replace(/(?<=[\d\-/.])\)(?=\d)/g, "1")
    .replace(/(?<=[\d\-/.])[lI](?=\d)/g, "1");
  const found: { index: number; iso: string }[] = [];
  const patterns = [
    /\b\d{1,2}(?:st|nd|rd|th)?\s+day\s+of\s+[A-Za-z]{3,9}\s*,?\s*\d{4}\b/gi,
    /\b\d{1,2}(?:st|nd|rd|th)?\s+[A-Za-z]{3,9}\s*,?\s*\d{4}\b/g,
    /\b[A-Za-z]{3,9}\s+\d{1,2}(?:st|nd|rd|th)?\s*,?\s*\d{4}\b/g,
    /\b\d{4}[-/.]\d{1,2}[-/.]\d{1,2}\b/g,
    /\b\d{1,2}[-/.]\d{1,2}[-/.]\d{4}\b/g,
    /\b\d{1,2}\s*[:.]\s*\d{1,2}\s*[:.]\s*\d{4}\b/g, // OCR: 16:01:2025
    /\b\d{1,2}\s*[:.]\s*\d{1,2}\s+(\d{4})\b/g, // OCR: 16:01 2025
    /\b\d{1,2}\s*[:.]\s*\d{1,2}\s*[-/]\s*\d{4}\b/g, // OCR mixed: 16:03-2025
    /\b\d{1,2}[-/.]\d{1,2}\s+\d{4}\b/g, // OCR: 16-01 2025
    /(?<!\d)\d{4}[-/.]\d{4}(?!\d)/g, // OCR fused ddmm: 2006/2025 → 20/06/2025
  ];
  for (const re of patterns) {
    for (const match of text.matchAll(re)) {
      const d = parseDateToken(match[0]);
      if (d) found.push({ index: match.index ?? 0, iso: d });
    }
  }
  found.sort((a, b) => a.index - b.index);
  const seen = new Set<string>();
  return found.filter((f) =>
    seen.has(f.iso) ? false : (seen.add(f.iso), true),
  );
}

function allDates(text: string): string[] {
  return allDateMatches(text).map((f) => f.iso);
}

/**
 * Find the date belonging to a label ("Issued on: 16.01.2025"). The capture
 * window is deliberately short AND refuses to cross into another date label —
 * otherwise a garbled value ("Issued on: <gibberish> Valid To: 31-12-2028")
 * would steal the neighbouring field's date.
 */
function findLabelledDate(
  text: string,
  labels: RegExp,
  stopLabels: RegExp = /\b(?:valid|expir\w*|renewal|issued?|certificate\s+date|prepared)\b/i,
): string | undefined {
  const re = new RegExp(`${labels.source}\\s*[:\\-–]?\\s*([^\\n]{0,44})`, "i");
  const m = text.match(re);
  if (!m) return undefined;
  const window = m[1];
  const first = allDateMatches(window)[0];
  if (!first) return undefined;
  const gap = window.slice(0, first.index);
  // Another field label (or a known date label) between our label and the
  // date means our label's own date was garbled — don't steal theirs.
  if (stopLabels.test(gap) || /[A-Za-z]{3,}\s*:/.test(gap)) return undefined;
  return first.iso;
}

// ── document type recognition ───────────────────────────────────────────────

/**
 * Recognized compliance document types. First match wins — more specific
 * patterns MUST come before generic ones. These cover the common fuel-station
 * permits/registrations (Kenya-first, generic enough for other countries).
 */
const DOC_TYPE_PATTERNS: { pattern: RegExp; label: string }[] = [
  {
    pattern:
      /certificate\s+of\s+compliance[\s\S]{0,200}(fire|safety)|(fire[\s\S]{0,120})certificate\s+of\s+compliance/i,
    label: "Fire Safety Compliance Certificate",
  },
  { pattern: /single\s+business\s+permit/i, label: "Single Business Permit" },
  {
    pattern: /tax\s+compliance\s+certificate/i,
    label: "Tax Compliance Certificate",
  },
  {
    pattern: /certificate\s+of\s+incorporation/i,
    label: "Certificate of Incorporation",
  },
  {
    pattern: /inspection\s+e-?sticker|motor\s+vehicle\s+inspection/i,
    label: "NTSA Vehicle Inspection Certificate",
  },
  {
    pattern: /emergency\s+response\s+(?:plan|preparedness|preparation)/i,
    label: "Emergency Response Plan",
  },
  { pattern: /\bCR\s*12\b/i, label: "CR12 — Registrar of Companies" },
  {
    pattern: /directors?'?[\s_-]*id\b/i,
    label: "Directors' National Identity Cards",
  },
  {
    pattern: /national\s+identity\s+card|identity\s+card/i,
    label: "National Identity Card",
  },
  {
    pattern: /certificate\s+of\s+calibration|calibration\s+certificate/i,
    label: "Road Tanker Calibration Certificate",
  },
  {
    pattern:
      /vehicle\s+(?:registration\s+)?log\s*book|registration\s+log\s*book|\blog\s*books?\b/i,
    label: "Vehicle Logbook",
  },
  {
    pattern: /county\s+trade\s+licen[cs]e|trade\s+licen[cs]e/i,
    label: "County Trade License",
  },
  {
    pattern: /environmental\s+(?:impact\s+assessment|certificate)|\bEIA\b/i,
    label: "NEMA Environmental Certificate",
  },
];

const PERMIT_KIND_WORDS =
  "licen[cs]e|permit|certificate|certification|registration|approval|authori[sz]ation|clearance|no[- ]?objection|compliance";

/** Kenyan-style vehicle registration plate (KCQ 783J / KCQ783J). */
const PLATE_RE = /\bK[A-Z]{2}\s?0?\d{3}\s?[A-Z]\b/;

/** Generic phrase matches that are actually field labels, not doc types. */
const FIELD_LABEL_TYPE_RE =
  /^(?:date|valid|expiry|expires|issued?\s+on|issue\s+date|name|address|telephone|email|certificate\s+no|permit\s+no|licen[cs]e\s+no)\b/i;

/** True when the label came from the recognized document-type catalogue. */
export function isCatalogueDocType(label?: string): boolean {
  return !!label && DOC_TYPE_PATTERNS.some((d) => d.label === label);
}

function normalizePlate(raw: string): string {
  const c = raw.replace(/\s+/g, "").toUpperCase();
  return /^K[A-Z]{2}\d{3}[A-Z]$/.test(c) ? `${c.slice(0, 3)} ${c.slice(3)}` : c;
}

/** Find the most likely permit/requirement type from the text. */
function guessPermitType(
  text: string,
  requiredPermits: string[],
): string | undefined {
  const lower = text.toLowerCase();
  // 1. A required permit named verbatim in the document wins.
  let best: { permit: string; score: number } | undefined;
  for (const p of requiredPermits) {
    const idx = lower.indexOf(p.toLowerCase());
    if (idx >= 0) {
      const score = 1000 - idx; // earlier mention = more likely the title
      if (!best || score > best.score) best = { permit: p, score };
    }
  }
  if (best) return best.permit;
  // 2. Recognized document-type catalogue.
  for (const { pattern, label } of DOC_TYPE_PATTERNS) {
    if (pattern.test(text)) return label;
  }
  // 3. Otherwise take the first "X Certificate/Licence/Permit…" phrase —
  // but never a field label ("Date of Registration" is not a document type).
  const re = new RegExp(
    `([A-Z][A-Za-z&'\\- ]{2,50}?(?:${PERMIT_KIND_WORDS}))`,
    "i",
  );
  const m = text.match(re);
  if (m) {
    const v = m[1].replace(/\s+/g, " ").trim();
    if (!/cam\s*scanner/i.test(v) && !FIELD_LABEL_TYPE_RE.test(v))
      return v.replace(/^./, (c) => c.toUpperCase());
  }
  return undefined;
}

// ── issuing authority recognition ───────────────────────────────────────────

const KNOWN_ISSUERS: { pattern: RegExp; label: string }[] = [
  {
    pattern: /kenya\s+revenue\s+authority|\bKRA\b|iTax/i,
    label: "Kenya Revenue Authority (KRA)",
  },
  {
    pattern: /national\s+transport\s+and\s+safety\s+authority|\bNTSA\b/i,
    label: "National Transport and Safety Authority (NTSA)",
  },
  {
    pattern:
      /registrar\s+of\s+companies|companies\s+registry|business\s+registration\s+service/i,
    label: "Business Registration Service (Registrar of Companies)",
  },
  {
    pattern: /registrar\s+of\s+persons|national\s+registration\s+bureau/i,
    label: "National Registration Bureau",
  },
  {
    pattern: /energy\s+(?:and|&)\s+petroleum\s+regulatory|\bEPRA\b/i,
    label: "Energy and Petroleum Regulatory Authority (EPRA)",
  },
  {
    pattern: /national\s+environment\s+management\s+authority|\bNEMA\b/i,
    label: "National Environment Management Authority (NEMA)",
  },
  {
    pattern: /weights?\s+and\s+measures/i,
    label: "County Inspectorate — Weights & Measures",
  },
];

function titleCase(s: string): string {
  return s
    .toLowerCase()
    .replace(/(?:^|\s)[a-z]/g, (c) => c.toUpperCase())
    .trim();
}

/** Try to pick an issuing authority from the text. */
function guessIssuer(text: string): string | undefined {
  // Known authorities first — more reliable than free-text lines.
  for (const { pattern, label } of KNOWN_ISSUERS) {
    if (pattern.test(text)) return label;
  }
  const county =
    text.match(/county\s+government\s+of\s+([a-z' ]{2,25})/i) ||
    text.match(/([a-z']{3,20})\s+county\s+government/i); // "Turkana County Government"
  if (county) return `County Government of ${titleCase(county[1])}`;
  const m =
    text.match(/issued\s+by\s*[:-]?\s*([^\n,;]{3,60})/i) ||
    text.match(/issuing\s+authority\s*[:-]?\s*([^\n,;]{3,60})/i) ||
    text.match(
      /(?:signed|authorised|authorized)\s+(?:by|for)\s*[:-]?\s*([^\n,;]{3,60})/i,
    );
  if (!m) return undefined;
  // stop at the next field label (pdfjs/OCR merges lines, so "Issued by: EPA
  // Contact: x@y" would otherwise bleed together)
  let v = m[1]
    .split(
      /\s+(?:contact|e-?mail|phone|tel|date|valid|certificate|licen[cs]e|permit|ref(?:erence)?)\b/i,
    )[0]
    .replace(/\s+[A-Z]?\s*$/, "") // trailing orphan word fragment
    .replace(/\s+or\s+[a-z]{1,3}$/i, "") // OCR garbage tail ("… or ie")
    .replace(/[.;,]\s*$/, "")
    .replace(/\s+/g, " ")
    .trim();
  // Repeatedly strip trailing short OCR fragments ("- Pa ol :", ". Pol",
  // " or ie") — a real authority name never ends in one. Punctuation-preceded
  // fragments may be up to 3 letters; space-preceded stay at 2 so a legit
  // trailing "Ltd" is never stripped.
  for (let i = 0; i < 4; i++) {
    const next = v
      .replace(/\s*[-–—:,;.]\s*[A-Za-z]{1,3}\s*$/, "")
      .replace(/\s+[A-Za-z]{1,2}\s*$/, "")
      .replace(/[-–—:,;.\s]+$/, "")
      .trim();
    if (next === v || next.length < 3) break;
    v = next;
  }
  return v.length >= 3 ? v : undefined;
}

/** Licence / permit / certificate / receipt reference number. */
function guessReference(text: string): string | undefined {
  const strip = (v: string) => v.replace(/[-/,.\s]+$/, "").trim();
  // 1. KRA PIN (P051431777E) — the definitive reference on tax documents.
  const kra = text.match(/\bP\d{9}[A-Z]\b/);
  if (kra) return kra[0];
  // 2. Explicit document reference labels.
  const doc = text.match(
    /(?:licen[cs]e|permit|certificate|registration)\s*(?:id|no\.?|number|#)\s*[:.-]?\s*([A-Z0-9][A-Z0-9/,-]{3,25})/i,
  );
  if (doc) return strip(doc[1]);
  // 3. NTSA e-sticker serial (e.g. ICELD202410020008).
  const serial = text.match(/\bICE[A-Z]{2}\d{10,}\b/);
  if (serial) return serial[0];
  // 4. Receipt / generic reference numbers.
  const rcpt = text.match(
    /(?:receipt|ref(?:erence)?|business)\s*(?:id|no\.?|number|#)\s*[:.-]?\s*([A-Z0-9][A-Z0-9/,-]{3,25})/i,
  );
  return rcpt ? strip(rcpt[1]) : undefined;
}

/** True when the text indicates a 12-month validity without a named expiry. */
function hasTwelveMonthValidity(text: string): boolean {
  return (
    /(?:valid|in\s+force|remains\s+in\s+force)[^.]{0,80}twelve[\s\w()]{0,25}m\w*ths/i.test(
      text,
    ) || /valid\s+for\s+twelve/i.test(text)
  );
}

function addMonths(isoDate: string, months: number): string {
  const d = new Date(isoDate + "T00:00:00");
  if (Number.isNaN(d.getTime())) return isoDate;
  const day = d.getDate();
  d.setMonth(d.getMonth() + months);
  if (d.getDate() !== day) d.setDate(0); // clamp to month end
  return d.toISOString().slice(0, 10);
}

/**
 * Extract compliance fields from raw document text. Pure + testable.
 */
export function extractComplianceFieldsFromText(
  rawText: string,
  requiredPermits: string[] = [],
): ExtractedComplianceFields {
  const out: ExtractedComplianceFields = {};
  const text = stripScanNoise(rawText || "");
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) return out;

  out.permitType = guessPermitType(text, requiredPermits);
  out.issuer = guessIssuer(text);
  out.reference = guessReference(text);

  const email = text.match(EMAIL_RE);
  if (email) out.issuerEmail = email[0];

  out.issueDate = findLabelledDate(
    text,
    /(?:date\s+of\s+issue|issued\s+on|date\s+of\s+registration|document\s+prepared|dated\s+this|issued\s+at|registration\s+date|c[eo]rtifi?cate\s+date|certification\s+date|date\s+of\s+calibration)(?:\s+date)?/i,
  );
  out.expiryDate = findLabelledDate(
    text,
    /(?:expir(?:y|ation|es)|valid\s+(?:until|till|through|up\s+to|to|for)|renewal\s+(?:due|date)|date\s+of\s+expiry)(?:\s+date)?/i,
  );

  // Fallbacks: unlabelled dates — earliest plausible = issue, latest = expiry.
  const dates = allDates(text).sort();
  // Never mirror a labelled expiry date into the issue date.
  if (!out.issueDate && dates.length && dates[0] !== out.expiryDate)
    out.issueDate = dates[0];
  // Some document types genuinely never expire (identity cards, logbooks,
  // CR12, incorporation, response plans) — don't invent an expiry for them.
  const neverExpires =
    !!out.permitType &&
    /identity|logbook|cr\s*12|incorporation|emergency\s+response/i.test(
      out.permitType,
    );
  if (!out.expiryDate && !neverExpires) {
    // Any later date than the issue date is a candidate expiry.
    const later = out.issueDate
      ? dates.filter((d) => d > out.issueDate!)
      : dates;
    if (later.length >= 1) out.expiryDate = later[later.length - 1];
    // "remains in force for twelve calendar months from the date thereof"
    if (!out.expiryDate && out.issueDate && hasTwelveMonthValidity(text))
      out.expiryDate = addMonths(out.issueDate, 12);
  }

  // Distinguishing detail: vehicle plate for vehicle documents.
  const plate = text.match(PLATE_RE);
  const plateSuffix = plate ? ` — ${normalizePlate(plate[0])}` : "";

  // Document name: the recognized type (plus plate when vehicle-scoped).
  if (out.permitType) {
    const vehicleDoc = /vehicle|tanker|inspection|logbook|calibration/i.test(
      out.permitType,
    );
    out.name =
      vehicleDoc && plateSuffix
        ? `${out.permitType}${plateSuffix}`
        : out.permitType;
  } else {
    const firstLine = text
      .split("\n")
      .map((l) => l.trim())
      .find((l) => l.length >= 8 && l.length <= 80 && !/^\W+$/.test(l));
    if (firstLine) out.name = firstLine.replace(/\s+/g, " ");
  }

  return out;
}

// ── filename heuristics (works even when a file can't be read at all) ───────

export function extractFromFilename(name: string): ExtractedComplianceFields {
  const base = name
    .replace(/\.[a-z0-9]+$/i, "")
    .replace(/\s*\(\d+\)\s*/g, " ") // drop "(1)" copy markers
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const out: ExtractedComplianceFields = {};
  if (base) {
    // Prefer the recognized catalogue over the raw filename for permitType.
    for (const { pattern, label } of DOC_TYPE_PATTERNS) {
      if (pattern.test(base)) {
        out.permitType = label;
        break;
      }
    }
    out.name = base.replace(/^./, (c) => c.toUpperCase());
    if (!out.permitType && new RegExp(PERMIT_KIND_WORDS, "i").test(base))
      out.permitType = out.name;
  }
  const year = base.match(/\b(19|20)\d{2}\b/);
  if (year) {
    const d = parseDateToken(base);
    if (d) out.expiryDate = d;
  }
  return out;
}

// ── main entry ──────────────────────────────────────────────────────────────

export interface ExtractOptions {
  /** OCR progress 0..1 (per page) for the UI spinner label. */
  onOcrProgress?: (progress: number) => void;
}

/**
 * Read a picked file and extract whatever fields we can. Never throws —
 * returns partial (possibly empty) results so the form keeps working.
 *
 * Text PDFs are read directly; scanned PDFs and images are analyzed
 * visually with on-device OCR so their fields (dates, issuer, reference,
 * document type) still auto-fill the form.
 */
export async function extractFromComplianceFile(
  file: File,
  requiredPermits: string[] = [],
  opts: ExtractOptions = {},
): Promise<ExtractedComplianceFields> {
  const fromName = extractFromFilename(file.name);
  let fromText: ExtractedComplianceFields = {};
  try {
    if (file.type === "application/pdf" || /\.pdf$/i.test(file.name)) {
      let text = await extractTextFromPdf(file);
      let method: ExtractionMethod = "pdf-text";
      // A scan yields little/no text — switch to visual analysis (OCR).
      if (stripScanNoise(text).replace(/\s+/g, " ").trim().length < 40) {
        const ocrText = await ocrCompliancePdf(file, opts.onOcrProgress);
        if (ocrText.trim().length > stripScanNoise(text).trim().length) {
          text = ocrText;
          method = "ocr";
        }
      }
      fromText = extractComplianceFieldsFromText(text, requiredPermits);
      fromText.method = method;
    } else if (/\.(txt|csv|md)$/i.test(file.name)) {
      fromText = extractComplianceFieldsFromText(
        await file.text(),
        requiredPermits,
      );
      fromText.method = "pdf-text";
    } else if (
      file.type.startsWith("image/") ||
      /\.(png|jpe?g|webp|bmp)$/i.test(file.name)
    ) {
      // Photos/scans of permits: visual analysis.
      const ocrText = await ocrComplianceImage(file, opts.onOcrProgress);
      if (ocrText.trim()) {
        fromText = extractComplianceFieldsFromText(ocrText, requiredPermits);
        fromText.method = "ocr";
      }
    }
  } catch {
    /* extraction is best-effort — never block the upload */
  }
  return mergeFilenameAndTextFields(fromName, fromText, requiredPermits);
}

/**
 * Merge filename-derived and text-derived fields. Precedence rules for noisy
 * OCR text: a filename match from the recognized-type catalogue beats a weak
 * generic phrase pulled out of garbled OCR text ("Registration Certificate"
 * from a logbook); a text-derived name is only trusted when it came from a
 * recognized type, otherwise the filename is the better source.
 */
export function mergeFilenameAndTextFields(
  fromName: ExtractedComplianceFields,
  fromText: ExtractedComplianceFields,
  requiredPermits: string[] = [],
): ExtractedComplianceFields {
  const merged = { ...fromName, ...stripUndefined(fromText) };
  if (
    fromText.permitType &&
    fromName.permitType &&
    isCatalogueDocType(fromName.permitType) &&
    !isCatalogueDocType(fromText.permitType) &&
    !requiredPermits.includes(fromText.permitType)
  ) {
    merged.permitType = fromName.permitType;
    merged.name = fromName.permitType;
  }
  if (!fromText.permitType && fromName.name) merged.name = fromName.name;
  return merged;
}

function stripUndefined(
  o: ExtractedComplianceFields,
): ExtractedComplianceFields {
  const r: ExtractedComplianceFields = { ...o };
  for (const k of Object.keys(r) as (keyof ExtractedComplianceFields)[]) {
    if (r[k] === undefined) delete r[k];
  }
  return r;
}

/** Merge extracted fields into the editor doc, filling EMPTY fields only. */
export function mergeExtractedIntoDoc(
  doc: ComplianceDocument,
  ex: ExtractedComplianceFields,
): { doc: ComplianceDocument; filled: string[] } {
  const filled: string[] = [];
  const next = { ...doc };
  const fill = <K extends keyof ComplianceDocument>(
    key: K,
    label: string,
    value: string | undefined,
  ) => {
    if (!value) return;
    const cur = next[key];
    if (typeof cur === "string" && cur.trim()) return; // never overwrite
    (next[key] as string) = value;
    filled.push(label);
  };
  fill("name", "name", ex.name);
  fill("permitType", "permit type", ex.permitType);
  fill("issuer", "issuing authority", ex.issuer);
  fill("issuerEmail", "authority email", ex.issuerEmail);
  fill("issueDate", "issue date", ex.issueDate);
  fill("expiryDate", "expiry date", ex.expiryDate);
  if (ex.reference) {
    const hasRef = (next.notes || "").includes(ex.reference);
    if (!hasRef) {
      next.notes = next.notes
        ? `${next.notes}\nRef: ${ex.reference}`
        : `Ref: ${ex.reference}`;
      filled.push("reference no.");
    }
  }
  return { doc: next, filled };
}
