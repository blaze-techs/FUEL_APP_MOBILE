/**
 * Ordered numeric-PIN search plan for "Quick Auto Unlock".
 *
 * Reverse-engineering note
 * ------------------------
 * pdfcandy.com/unlock-pdf.html does NOT recover passwords. Its bundle
 * (`static.pdfcandy.com/js/app.*.js`) loads pdfjs + pdf-lib and calls
 * `pdfjsLib.getDocument({ data })` with NO password; the pdfjs
 * `onPassword(callback, reason)` hook then opens a modal (reason 1 =
 * NEED_PASSWORD, 2 = INCORRECT_PASSWORD) and the user types the password.
 * pdf-lib re-saves the decrypted document unencrypted. Its only "quick,
 * no-password" path is that a PDF whose user password is EMPTY — i.e. a
 * permissions/owner-restricted file — opens with no prompt at all, because
 * pdfjs accepts the empty string as the user password.
 *
 * So a genuinely "no need for PDF Password" experience has to come from the
 * PIN itself being recoverable. For M-PESA statements the PIN is a short
 * numeric code, and the overwhelming majority are a *known* one: the user's
 * own phone/till/ID, the statement period, or a weak common PIN. This module
 * lays those out cheapest-first so the common case finishes in milliseconds
 * instead of walking the whole numeric space.
 *
 * Ordering rationale (cost, not guesswork):
 *   1. Contextual — derived from the filename + the readable parts of the
 *      statement (period, shortcode, phone, request date). Practically free.
 *   2. Common PIN hotlist — the classic weak-PIN space (repeats, runs,
 *      keyboard patterns, 123456/112233/…, years). ~1k candidates, ~every
 *      leaked-PIN study puts 15–25% of real PINs here.
 *   3. Exhaustive 4-digit — only 10k, the cheapest space, scanned early.
 *   4. Exhaustive 5-digit — 100k.
 *   5. Exhaustive 6-digit — 1M, the true last resort.
 */

export interface PinPlanSegment {
  /** number of digits in this block (0 = literal candidates) */
  digits: number;
  /** inclusive decimal start (ignored for literal blocks) */
  start: number;
  /** exclusive decimal end (ignored for literal blocks) */
  end: number;
  /** for digits === 0: the exact strings to try, in order */
  literal?: string[];
  /** display label for progress reporting */
  label: string;
}

/** The classic weak-PIN space: repeats, runs, patterns, common codes. */
const COMMON_PIN_SEED: string[] = [
  "000000",
  "111111",
  "222222",
  "333333",
  "444444",
  "555555",
  "666666",
  "777777",
  "888888",
  "999999",
  "123456",
  "654321",
  "121212",
  "112233",
  "123123",
  "111222",
  "102030",
  "123123",
  "123321",
  "456789",
  "987654",
  "147258",
  "159357",
  "159753",
  "112211",
  "258000",
  "000258",
  "1789",
  "1278",
  "2846",
  "0696",
  "1998",
  "1999",
  "2000",
  "2001",
  "2002",
  "2003",
  "2004",
  "2005",
  "2006",
  "2007",
  "2008",
  "2009",
  "2010",
  "2011",
  "2012",
  "2013",
  "2014",
  "2015",
  "2016",
  "2017",
  "2018",
  "2019",
  "2020",
  "2021",
  "2022",
  "2023",
  "2024",
  "2025",
  "2026",
  "1234",
  "12345",
  "0000",
  "1111",
  "2222",
  "3333",
  "4444",
  "5555",
  "6666",
  "7777",
  "8888",
  "9999",
  "1111",
  "1212",
  "1122",
  "1313",
  "1010",
  "0101",
  "2468",
  "1357",
  "0001",
  "1000",
  "2000",
  "3000",
  "1230",
  "4321",
  "5683",
  "5252",
  "9999",
  "7756",
  "2255",
  // Kenya / M-PESA hotlist
  "2547",
  "2541",
  "0722",
  "0733",
  "0711",
  "0700",
  "0800",
  "247365",
  "254254",
  "072254",
  "254722",
  "254733",
];

/** Cheap "human" 6-digit patterns that are not in the seed above. */
function patternPins4(): string[] {
  const out: string[] = [];
  for (let d = 0; d <= 9; d++) {
    const s = String(d);
    out.push(s + s + s + s); // 7777
    out.push(s + s + s + "0"); // 7770
    out.push(s + s + "00"); // 7700
    out.push(s + "000"); // 7000
  }
  return out;
}

/** Build the seed hotlist (deduped, insertion order = priority order). */
export function buildCommonPinList(): string[] {
  const set = new Set<string>();
  const add = (v: string) => {
    const t = v.replace(/\D/g, "");
    if (t.length >= 4 && t.length <= 8) set.add(t);
  };
  for (const s of COMMON_PIN_SEED) add(s);
  for (const s of patternPins4()) add(s);
  // Every 4-digit seed also tried as its zero-padded twin, so a station whose
  // PIN is a 4-digit code but whose statement requires 6 digits (e.g. "1234"
  // -> "001234") still hits.
  for (const s of [...set]) {
    if (s.length === 4) {
      add("00" + s);
      add(s + "00");
      add("0" + s + "0");
    } else if (s.length === 5) {
      add("0" + s);
      add(s + "0");
    }
  }
  return [...set];
}

/**
 * Contextual numeric candidates pulled from what we can read WITHOUT the
 * password: the file name, and — when a text layer is available — the
 * statement header (shortcode, phone, period, request date).
 *
 * These are the same signals the previous implementation used, kept as the
 * first (free) tier of the plan.
 */
export function contextualPins(
  filename?: string,
  statementText?: string,
): string[] {
  const out = new Set<string>();
  const addTokens = (src: string) => {
    for (const m of src.match(/\d{4,16}/g) || []) {
      for (const len of [4, 5, 6]) {
        if (m.length >= len) {
          out.add(m.slice(-len));
          out.add(m.slice(0, len));
        }
      }
      out.add(m);
    }
  };

  if (filename) addTokens(filename.replace(/\.pdf$/i, ""));
  if (statementText) addTokens(statementText.slice(0, 4000));

  // Digit reorderings of an 8-digit date (YYYYMMDD <-> DDMMYYYY). Statements
  // are usually named after their period, so the filename counts too.
  const dateSource = `${filename ?? ""}\n${statementText ?? ""}`;
  const dates = dateSource.match(/20\d{2}[-_/ ]?\d{2}[-_/ ]?\d{2}/g) || [];
  for (const d of dates) {
    const digits = d.replace(/\D/g, "");
    if (digits.length === 8) {
      out.add(digits);
      out.add(digits.slice(6) + digits.slice(4, 6) + digits.slice(0, 4));
      out.add(digits.slice(4, 6) + digits.slice(6) + digits.slice(0, 4));
      for (const len of [4, 5, 6]) out.add(digits.slice(-len));
    }
  }

  return [...out];
}

/** Digit widths to scan exhaustively, cheapest first. */
export const EXHAUSTIVE_WIDTHS = [4, 5, 6] as const;

/**
 * Build the ordered plan. Contextual + common blocks first (instant), then the
 * exhaustive numeric spaces from the narrowest (cheapest) upward.
 */
export function buildPinPlan(opts?: {
  filename?: string;
  statementText?: string;
  /** Explicit passwords already tried by the caller (kept first, deduped). */
  known?: string[];
  minDigits?: number;
  maxDigits?: number;
}): PinPlanSegment[] {
  const min = opts?.minDigits ?? 4;
  const max = Math.min(opts?.maxDigits ?? 6, 6);
  const segs: PinPlanSegment[] = [];

  // Any password the caller already tried (the empty string, known passwords,
  // filename hints) sits at the very front so the plan remains a superset of
  // the old candidate list — a hit is never missed by reordering.
  const known = (opts?.known ?? []).filter((v) => typeof v === "string");
  if (known.length) {
    segs.push({
      digits: 0,
      start: 0,
      end: 0,
      literal: known,
      label: "known passwords",
    });
  }

  const contextual = contextualPins(opts?.filename, opts?.statementText).filter(
    (v) => !known.includes(v),
  );
  if (contextual.length) {
    segs.push({
      digits: 0,
      start: 0,
      end: 0,
      literal: contextual,
      label: "statement details",
    });
  }

  const common = buildCommonPinList();
  if (common.length) {
    segs.push({
      digits: 0,
      start: 0,
      end: 0,
      literal: common,
      label: "common PINs",
    });
  }

  for (const width of EXHAUSTIVE_WIDTHS) {
    if (width < min || width > max) continue;
    segs.push({
      digits: width,
      start: width === 4 ? 0 : Math.pow(10, width - 1),
      end: Math.pow(10, width),
      label: `${width}-digit PINs`,
    });
  }

  return segs;
}

/** Total candidates a plan will try (for percentage progress). */
export function pinPlanSize(plan: PinPlanSegment[]): number {
  let n = 0;
  for (const s of plan) {
    n += s.digits === 0 ? (s.literal?.length ?? 0) : s.end - s.start;
  }
  return n;
}
