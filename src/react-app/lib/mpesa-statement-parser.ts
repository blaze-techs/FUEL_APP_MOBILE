/**
 * Adaptive M-PESA statement parser.
 *
 * M-PESA statements come in many layouts and the format changes over time:
 *   - OLD flat format  : one transaction per line
 *       "TIA9B1U5VV 2025-09-10 18:26:58 Merchant Payment from 254727***578 -
 *        ESTHER IKARU Completed 2,000.00 0.00 43,336.47 Customer Merchant Payment"
 *   - NEW grid format  : each transaction is a 3-6 row visual grid cell.
 *       Row1(TIA…, date, details, status, paid-in, withdrawn, balance, type, party)
 *       Row2(time, phone - name, type-cont, party-cont)
 *       Row3(surname-cont, …, …)
 *   - OCR / pasted text: single column, rows may be re-flowed / wrapped.
 *
 * Instead of hard-coding any single layout, this module:
 *   1. splits the raw rows into per-transaction BLOCKS by locating
 *      "key rows" (a row that looks like a transaction start: it carries a
 *      receipt code AND a date OR a status token with money amounts), then
 *   2. adaptively extracts fields from each block using position-aware
 *      heuristics + keyword adjacency — never fixed column indices, so a
 *      future format change is handled by the same grouping logic.
 */

export interface MpesaRow {
  text: string;
  /** optional horizontal position (pdfjs pdf-unit x) — enables column reconstruction */
  x?: number;
  /** optional vertical position (pdfjs pdf-unit y) */
  y?: number;
}

export interface MpesaInflow {
  details: string;
  paidIn: number;
  balance: number;
  receipt: string;
  date: string;
  time: string;
  isOnline: boolean;
}

export interface MpesaExcluded {
  receipt: string;
  date: string;
  type: string;
  amount: number;
  reason: string;
}

export interface MpesaParseResult {
  inflows: MpesaInflow[];
  excluded: MpesaExcluded[];
  /** detected layout name, useful for diagnostics */
  format: "flat" | "grid" | "scan" | "unknown";
  /** number of candidate transaction blocks found (pre-filter) */
  candidates: number;
}

/* ----------------------------- constants ----------------------------- */

const RECEIPT_RE = /\b[A-Z0-9]{10}\b/;
const DATE_RE = /\d{4}-\d{2}-\d{2}/;
const TIME_RE = /\d{2}:\d{2}(?::\d{2})?/;
// Strict money: requires the trailing decimal (M-PESA always prints 2dp).
// This deliberately does NOT match integers inside times (18:26:58), the
// merchant shortcode (578590-) or 4-digit years, so blocks don't miscount.
const MONEY_RE = /\d{1,3}(?:,\d{3})*\.\d{1,2}/g;
// Sign-aware money: captures an optional leading minus so charges/withdrawals
// keep their sign (NEW format prints -13.75 for a charge). Both regexes must
// stay in sync; the -? prefix makes them match negative M-PESA amounts too.
const SIGNED_MONEY_RE = /-?\d{1,3}(?:,\d{3})*\.\d{1,2}/g;
// Phone: either a masked M-PESA id (0700***123 / 2547***123) or a full number.
const PHONE_RE = /(?:\+?254)?(?:[0-9]{3,4}\*+[0-9]{1,4}|\d{9,12})/;
const STATUS_RE =
  /\b(Completed|Failed|Pending|Expired|Reversed|Cancelled|Initiated)\b/i;

/** transaction type taxonomy — keyword -> canonical type */
const TYPE_RULES: Array<[RegExp, string]> = [
  [/Merchant Payment (?:Online )?from/i, "merchant_payment"],
  [/Merchant Payment Online\b/i, "merchant_payment"],
  [/Small Business Pay Merchant/i, "merchant_payment"],
  [
    /Merchant to Merchant Payment Charge|Merchant to Customer Payment Charge/i,
    "merchant_charge",
  ],
  [
    /Pay merchant Charge|Pay Merchant Charge|Merchant Payment Charge/i,
    "merchant_charge",
  ],
  [
    /Merchant Customer Payment to|Merchant to Customer|Merchant to Merchant/i,
    "merchant_transfer",
  ],
  [/Merchant to Utility|Merchant Pay Utility/i, "utility_payment"],
  [/Funds Transfer/i, "funds_transfer"],
  [/Buy Goods/i, "buy_goods"],
  [/Pay Bill/i, "pay_bill"],
  [/Sell Airtime/i, "sell_airtime"],
  [/Withdraw to Bank/i, "withdraw_bank"],
  [/Withdraw at Agent/i, "withdraw_agent"],
  [/Fuliza|M-Shwari|KCB M-PESA| Savings Widget/i, "loan_repayment"],
  [/Loan Disbursement/i, "loan_disbursement"],
  [/Biashara Overdraft/i, "overdraft"],
];

/* --------------------------- small helpers --------------------------- */

function toNumber(raw: string | undefined | null): number {
  if (!raw) return 0;
  const n = parseFloat(raw.replace(/,/g, ""));
  return Number.isFinite(n) ? n : 0;
}

/** extract a full receipt code ignoring word boundaries that a PDF may split */
function findReceipt(text: string): string {
  const m = text.match(RECEIPT_RE);
  return m ? m[0] : "";
}

/** normalize a date found in many formats to YYYY-MM-DD */
function normalizeDate(raw: string): string {
  const iso = raw.match(/\d{4}-\d{2}-\d{2}/);
  if (iso) return iso[0];

  const dmy = raw.match(
    /(\d{1,2})[/.\- ]([A-Za-z]{3,9}|\d{1,2})[/.\- ](\d{4})/,
  );
  if (dmy) {
    const [, dd, monRaw, yy] = dmy;
    const months: Record<string, string> = {
      jan: "01",
      feb: "02",
      mar: "03",
      apr: "04",
      may: "05",
      jun: "06",
      jul: "07",
      aug: "08",
      sep: "09",
      oct: "10",
      nov: "11",
      dec: "12",
    };
    let mm: string;
    if (/^\d+$/.test(monRaw)) mm = monRaw.padStart(2, "0");
    else mm = months[monRaw.slice(0, 3).toLowerCase()] ?? monRaw;
    if (mm.length === 2 && Number(mm) >= 1 && Number(mm) <= 12) {
      return `${yy}-${mm}-${dd.padStart(2, "0")}`;
    }
  }
  const mdy = raw.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (mdy) {
    // Ambiguous us/uk — prefer day-first unless first > 12
    const [, a, b, yy] = mdy;
    let dd = a;
    let mm = b;
    if (Number(a) > 12) {
      dd = a;
      mm = b;
    } else if (Number(b) > 12) {
      dd = b;
      mm = a;
    }
    return `${yy}-${mm.padStart(2, "0")}-${dd.padStart(2, "0")}`;
  }
  return "";
}

function classifyBlockType(block: MpesaRow[]): string {
  const joined = block.map((r) => r.text).join(" ");
  for (const [re, type] of TYPE_RULES) {
    if (re.test(joined)) return type;
  }
  // If it has a receipt + a status, it's a transaction we didn't name
  if (findReceipt(joined) && STATUS_RE.test(joined))
    return "unknown_transaction";
  return "";
}

function isExemptType(type: string): boolean {
  // NOTE: "buy_goods" and "merchant_payment" are deliberately NOT in this list.
  // In current M-PESA statements "Buy Goods" is the Transaction-Type label on
  // inflow rows (it means money RECEIVED via a till), not an outflow.
  return (
    type === "merchant_charge" ||
    type === "loan_disbursement" ||
    type === "overdraft" ||
    type === "utility_payment" ||
    type === "merchant_transfer" ||
    type === "funds_transfer" ||
    type === "pay_bill" ||
    type === "withdraw_bank" ||
    type === "withdraw_agent" ||
    type === "loan_repayment"
  );
}

/* ----------------------- transaction-block detection ----------------------- */

/**
 * A key row starts a new transaction block. Two detection strategies:
 *  - strong: row carries a receipt AND a date/status (flat + grid key rows)
 *  - weak:   row carries "Merchant Payment" OR a receipt+status (OCR/scan)
 */
function isKeyRow(row: MpesaRow): boolean {
  const t = row.text;
  const hasReceipt = RECEIPT_RE.test(t);
  const hasDate =
    DATE_RE.test(t) ||
    /(\d{1,2})([/.\- ]|\s)([A-Za-z]{3,9}|\d{1,2})([/.\- ]|\s)(\d{4})/.test(t);
  const hasStatus = STATUS_RE.test(t);
  const hasMoney = (t.match(MONEY_RE) || []).length >= 2;
  const hasPayment = /Merchant Payment|Pay Merchant/i.test(t);

  if (hasReceipt && (hasDate || hasStatus) && hasMoney) return true;
  // A "Merchant Payment from" + status + money + receipt is a strong signal.
  if (hasPayment && hasStatus && hasMoney && hasReceipt) return true;
  // Flat-line old format: "Receipt date time details status paid withdrawn balance"
  // is all on one line — already covered above.
  // OCR/scan fallback: a bare "Merchant Payment from <phone> - <name>" line
  // that carries a phone but may have the money/status split onto following
  // rows still starts a block.
  if (hasPayment && PHONE_RE.test(t)) return true;
  return false;
}

/** Re-combine continuation rows (the wrapped details/type/party) into 1 text */
function flattenBlock(block: MpesaRow[]): string {
  return block
    .map((r) => r.text.trim())
    .filter(Boolean)
    .join(" ");
}

/* ------------------------------ per-block parse ------------------------------ */

function parseBlock(block: MpesaRow[]): MpesaInflow | MpesaExcluded | null {
  const flat = flattenBlock(block);
  const type = classifyBlockType(block);
  const amounts = extractAmounts(flat);

  // Skip known non-inflow types entirely (they're noise, not revenue)
  if (isExemptType(type)) {
    const outgoing = amounts.withdrawn || amounts.paidIn;
    return {
      receipt: findReceipt(flat),
      date: findDate(flat),
      type: type || "excluded",
      amount: outgoing > 0 ? outgoing : amounts.balance,
      reason: excludeReason(type),
    } as MpesaExcluded;
  }

  // Only rows that clearly RECEIVED money count as revenue inflows:
  //   - type is a payment IN (merchant_payment / buy_goods / small business)
  //   - the transaction amount is POSITIVE (charges print a minus)
  // Also require the block to actually say it RECEIVED (a "Merchant Payment …",
  // "Pay Merchant", "received from <agency>", "Buy Goods" or a "from" in the
  // continuation row — so we never turn an exempt charge/transfer into revenue).
  const typeIsInflow = type === "merchant_payment" || type === "buy_goods";
  const receivedPhrase =
    typeIsInflow ||
    /received from|Pay Merchant|Small Business|Buy Goods|Merchant Payment|\bfrom\b/i.test(
      flat,
    );
  const paidIn = amounts.paidIn;

  // Unknown-but-positive transactions are still legitimate inflows when the
  // statement explicitly gives a positive Paid In amount and a resulting
  // balance. The old implementation dropped these because they lacked one of
  // the hard-coded wording patterns above. Known exempt types have already
  // returned from the function, so this fallback cannot turn known outflows
  // into revenue.
  const safeUnknownPositiveInflow =
    type === "unknown_transaction" && paidIn > 0 && amounts.balance > 0;

  if ((!receivedPhrase && !safeUnknownPositiveInflow) || paidIn <= 0) {
    // A withdrawn-only row that's not an explicitly-exempt type — drop it
    return null;
  }

  const { details, phone, name } = extractIdentity(block, flat);

  const date = findDate(flat);
  const timeMatch = flat.match(TIME_RE);
  const isOnline = /Online/i.test(flat) || /Online/i.test(details);

  return {
    details:
      details ||
      (name ? name : phone ? `Payment from ${phone}` : "Merchant Payment"),
    paidIn,
    balance: amounts.balance,
    receipt: findReceipt(flat),
    date,
    time: timeMatch ? timeMatch[0] : "",
    isOnline,
  } as MpesaInflow;
}

function excludeReason(type: string): string {
  switch (type) {
    case "loan_disbursement":
    case "overdraft":
      return "Loan/Overdraft - not operating revenue";
    case "merchant_charge":
      return "Merchant charge";
    case "utility_payment":
      return "Utility payment";
    case "merchant_transfer":
    case "funds_transfer":
      return "Transfer";
    case "pay_bill":
      return "Bill payment";
    case "buy_goods":
      return "Goods purchase";
    case "withdraw_bank":
    case "withdraw_agent":
      return "Withdrawal";
    case "loan_repayment":
      return "Loan repayment";
    default:
      return "Not operating revenue";
  }
}

function findDate(flat: string): string {
  const m =
    flat.match(DATE_RE) ||
    flat.match(/(\d{1,2})[/.\- ]([A-Za-z]{3,9}|\d{1,2})[/.\- ](\d{4})/) ||
    flat.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  return m ? normalizeDate(m[0]) : "";
}

/**
 * Extract the monetary columns in a M-PESA transaction row.
 *
 * ADAPTIVE: the OLD format always prints 3 values [Paid-in, Withdrawn,
 * Balance]; the CURRENT format OMITS the Withdrawn column entirely when it is
 * zero, so only [Paid-in, Balance] (or [Withdrawn, Balance]) appear — and the
 * transaction amount may be NEGATIVE (charges print "-13.75"). Instead of
 * assuming a fixed column count we use the sign + position:
 *   - 3 values → [Paid-in, Withdrawn, Balance]
 *   - 2 values → [Amount, Balance]; amount is paid-in if > 0 else withdrawn
 *   - 1 value  → Balance (or a lone label-less amount ambiguity → lowest risk)
 * When labels are present ("Paid in", "Withdrawn", "Balance", "Debit", ...)
 * they win over position.
 */
function extractAmounts(flat: string): {
  paidIn: number;
  withdrawn: number;
  balance: number;
} {
  // Label-aware (all known label spellings, incl. the multi-line header
  // "Paid In"/"Withdrawn"/"Balance" that pdfjs sometimes joins onto rows)
  const paidLabel = flat.match(/Paid ?In[^\d-]*(-?[\d,]+\.\d{2})/i);
  const withdrawnLabel = flat.match(/Withdrawn[^\d-]*(-?[\d,]+\.\d{2})/i);
  const balanceLabel = flat.match(/Balance[^\d-]*(-?[\d,]+\.\d{2})/i);

  const hasLabels = Boolean(paidLabel || withdrawnLabel || balanceLabel);
  if (hasLabels) {
    return {
      paidIn: paidLabel ? toNumber(paidLabel[1]) : 0,
      withdrawn: withdrawnLabel ? toNumber(withdrawnLabel[1]) : 0,
      balance: balanceLabel ? toNumber(balanceLabel[1]) : 0,
    };
  }

  const tokens = flat.match(SIGNED_MONEY_RE) || [];
  const nums = tokens.map((t) => toNumber(t));

  if (nums.length === 0) return { paidIn: 0, withdrawn: 0, balance: 0 };

  // 3 values → classic [Paid-in, Withdrawn, Balance]
  if (nums.length >= 3) {
    return {
      paidIn: nums[nums.length - 3],
      withdrawn: nums[nums.length - 2],
      balance: nums[nums.length - 1],
    };
  }

  // 2 values → [Amount, Balance] (Withdrawn omitted when zero)
  if (nums.length === 2) {
    const [first, balance] = nums;
    // A negative first value is a withdrawn/charge (sign preserved)
    return {
      paidIn: first > 0 ? first : 0,
      withdrawn: first < 0 ? -first : 0,
      balance,
    };
  }

  // 1 value → ambiguous; prefer treating it as paid-in ONLY when > 0 and
  // the row signals receipt. Otherwise leave it as the balance.
  return {
    paidIn: nums[0] > 0 ? nums[0] : 0,
    withdrawn: nums[0] < 0 ? -nums[0] : 0,
    balance: 0,
  };
}

/** Reconstruct the customer identity from the Details column across rows */
function extractIdentity(
  block: MpesaRow[],
  flat: string,
): {
  details: string;
  phone: string;
  name: string;
} {
  // Grid rows carry OTHER columns next to the name ("Merchant", "PUBLICAN",
  // "ENERGY", "Buy Goods", "with OD via STK", "Pay", shortcode, time, money,
  // status, the receipt code). Drop those noise tokens on a word level so only
  // the customer-name fragments remain. `with OD via STK` is a FundingSource
  // label (Pay Merchant withdrawals), `Pay` is part of "Pay Merchant".
  const NOISE =
    /(?:Customer|Merchant|PUBLICAN|ENERGY|SWAFIA|SWAFIA|BUY GOODS|Buy Goods|with OD via STK|Via STK|\bOD\b|\bPay\b|Payment|Completed|Failed|Pending|Expired|Reversed|Cancelled|Initiated|Deposit|Withdrawal|Savings|Fuliza|Overdraft|Online|from|From|\bto\b|received|Received|via API|Business|Account Type|\bwith\b)/gi;
  const stripNoiseWords = (s: string) =>
    s
      .replace(NOISE, " ")
      .replace(/\b\d{4}-\d{2}-\d{2}\b/g, " ")
      .replace(/\b\d{1,2}:\d{2}(?::\d{2})?\b/g, " ")
      .replace(/-?\d{1,3}(?:,\d{3})*\.\d{1,2}\b/g, " ")
      // Receipt codes are 10 alphanumeric chars and always contain at least
      // one digit (UIBJN5YMQC). Never strip pure-alpha tokens here — a
      // 9-12 char all-caps word is almost always a customer name like
      // VERONICAH, not a receipt.
      .replace(/\b(?=[A-Z0-9]*\d)[A-Z0-9]{9,12}\b/g, " ")
      .replace(/\d{4,6}\s*-?$/g, " ")
      .replace(/\s+/g, " ")
      .trim();

  const phoneMatch = flat.match(PHONE_RE);
  const phone = phoneMatch ? phoneMatch[0] : "";

  // Gather name fragments: prefer the row that carries the phone, then append
  // any remaining word-fragments from the other rows.
  let name = "";
  const phoneRow = block.find((r) => PHONE_RE.test(r.text));
  if (phoneRow) {
    // The new grid layout puts the name AFTER the masked phone with no dash:
    // "17:36:51 0706***777 VERONICAH PUBLICAN". The old one used a dash:
    // "18:26:32 0746***921 - isaac alemu aleper". Strip the phone itself first
    // so the surviving words are exactly the name fragments.
    const rest = phoneRow.text.replace(PHONE_RE, "");
    const afterDash = rest.match(/^\s*-\s*(.+)/);
    name = stripNoiseWords(afterDash ? afterDash[1] : rest);
    // The phone must never leak into the name.
    name = name.replace(PHONE_RE, " ").replace(/\s+/g, " ").trim();
  }

  // Append surname/first-name fragments from non-phone rows (the grid layout
  // wraps the name across 2–3 rows). Also strip any embedded phone/dashes.
  for (const r of block) {
    if (r === phoneRow || !r.text.trim()) continue;
    const frag = stripNoiseWords(r.text).replace(PHONE_RE, "");
    if (!frag || frag.length < 2) continue;
    for (const word of frag.split(/\s+/)) {
      const wl = word.toLowerCase();
      if (
        word.length >= 2 &&
        !/[0-9*]/.test(word) &&
        !name.toLowerCase().includes(wl) &&
        ![
          "payment",
          "energy",
          "swafia",
          "publican",
          "customer",
          "merchant",
          "buy",
          "goods",
          "business",
          "od",
          "pay",
          "stk",
        ].includes(wl)
      ) {
        name += ` ${word}`;
      }
    }
  }

  // Fallback: inline "Merchant Payment from <name>" on a single line.
  if (!phoneRow) {
    const inline = flat.match(
      /Merchant Payment(?: Online)? from\s+(.+?)(?:\s+Completed|$)/i,
    );
    if (inline) {
      const frags = stripNoiseWords(inline[1])
        .split(" ")
        .filter((w) => w && w.length >= 2 && !/[0-9*]/.test(w));
      name = frags.join(" ");
    }
  }

  name = name
    .replace(/\s+/g, " ")
    .replace(/\s*-\s*-+\s*/g, " ")
    .replace(/^\s*-+\s*|\s*-+\s*$/g, "")
    .trim();

  const details = [phone && `Payment from ${phone}`, name || undefined]
    .filter(Boolean)
    .join(" - ")
    .replace(/\s*-\s*-+\s*/g, " - ")
    .trim();

  return { details, phone, name };
}

/* ------------------------------ public API ------------------------------ */

/** Detect the dominant layout from rows (for diagnostics) */
export function detectFormat(rows: MpesaRow[]): MpesaParseResult["format"] {
  const texts = rows.map((r) => r.text).filter(Boolean);
  const isKey = (t: string) =>
    RECEIPT_RE.test(t) &&
    (DATE_RE.test(t) || STATUS_RE.test(t)) &&
    (t.match(MONEY_RE) || []).length >= 2;

  const keyRows = texts.filter(isKey).length;
  if (keyRows === 0) {
    return texts.some((t) => /Merchant Payment/i.test(t)) ? "scan" : "unknown";
  }

  // In a TRUE grid layout the key rows are separated by continuation rows
  // (time/phone/name/type leftovers). In the flat layout key rows are
  // adjacent — every row is self-contained.
  let gaps = 0;
  let prevKey = -1;
  for (let i = 0; i < texts.length; i++) {
    if (!isKey(texts[i])) continue;
    if (prevKey !== -1 && i - prevKey > 1) gaps++;
    prevKey = i;
  }

  // If a meaningful share of key rows have a continuation row between them,
  // it's the multi-row grid layout.
  return gaps >= Math.ceil(keyRows * 0.25) ? "grid" : "flat";
}

/**
 * Drop the per-page boilerplate rows that pdfjs may attach to a transaction's
 * continuation block at page boundaries (the safety/disclaimer footer, the
 * statement verification code, "Page X of Y", the repeated column header row,
 * and standalone "M-PESA STATEMENT"/"Account Type - …" lines). These are never
 * part of a transaction's Details and would otherwise pollute names.
 */
function isPageNoiseRow(text: string): boolean {
  return (
    /Disclaimer:|Statement Verification Code|For self-help|Page \d+ of \d+/.test(
      text,
    ) ||
    /^Receipt No\. Completion Details .* Transaction/.test(text) ||
    /^M-PESA STATEMENT$/.test(text.trim()) ||
    /^Account Type(\s*-)?\s/.test(text.trim()) ||
    /^XX9Y6NLU$/.test(text.trim()) ||
    /^Receipt No Till Number Amount/.test(text.trim())
  );
}

/**
 * Parse any M-PESA statement rows into inflows + exclusions.
 * Works across the flat, grid, and OCR/scan layouts with no layout flag.
 */
export function parseMpesaRows(rows: MpesaRow[]): MpesaParseResult {
  const clean: MpesaRow[] = rows
    .filter((r) => r.text && r.text.trim() && !isPageNoiseRow(r.text.trim()))
    .map((r) => ({ ...r, text: r.text.trim() }));

  if (!clean.length)
    return { inflows: [], excluded: [], format: "unknown", candidates: 0 };

  // Split into blocks at key rows.
  const blocks: MpesaRow[][] = [];
  let current: MpesaRow[] | null = null;
  for (const row of clean) {
    if (isKeyRow(row)) {
      if (current && current.length) blocks.push(current);
      current = [];
    }
    // attach to current block, or standalone continuation starts nothing
    // (blocks are ALWAYS started by a key row)
    if (current) current.push(row);
  }
  if (current && current.length) blocks.push(current);

  const format = detectFormat(clean);
  const inflows: MpesaInflow[] = [];
  const excluded: MpesaExcluded[] = [];

  for (let b = 0; b < blocks.length; b++) {
    const res = parseBlock(blocks[b]);
    if (!res) continue;
    if ("reason" in res) excluded.push(res);
    else inflows.push(res);
  }

  return { inflows, excluded, format, candidates: blocks.length };
}

/**
 * Convenience: parse a plain string[] (OCR) without spatial data.
 */
export function parseMpesaLines(lines: string[]): MpesaParseResult {
  return parseMpesaRows(lines.map((l) => ({ text: l })));
}

/**
 * Detect whether a pdfjs extraction error indicates a password-protected PDF,
 * so the UI can surface a targeted, actionable message.
 */
export function isPasswordProtectedPdfError(message: string): boolean {
  return (
    /password|encrypt|encrypted/i.test(message) &&
    !/decrypt|authenticate/i.test(message)
  );
}
