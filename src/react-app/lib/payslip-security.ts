// Real security features for the payslip: SHA-256 document hash,
// verifiable QR payload, and a genuine ISO/IEC 15417 Code 128C barcode
// (scannable by any barcode reader — not a decorative pattern).

const CODE128_PATTERNS: string[] = [
  "212222",
  "222122",
  "222221",
  "121223",
  "121322",
  "131222",
  "122213",
  "122312",
  "132212",
  "221213",
  "221312",
  "231212",
  "112232",
  "122132",
  "122231",
  "113222",
  "123122",
  "123221",
  "223211",
  "221132",
  "221231",
  "213212",
  "223112",
  "312131",
  "311222",
  "321122",
  "321221",
  "312212",
  "322112",
  "322211",
  "212123",
  "212321",
  "232121",
  "111323",
  "131123",
  "131321",
  "112313",
  "132113",
  "132311",
  "211313",
  "231113",
  "231311",
  "112133",
  "112331",
  "132131",
  "113123",
  "113321",
  "133121",
  "313121",
  "211331",
  "231131",
  "213113",
  "213311",
  "213131",
  "311123",
  "311321",
  "331121",
  "312113",
  "312311",
  "332111",
  "314111",
  "221411",
  "431111",
  "111224",
  "111422",
  "121124",
  "121421",
  "141122",
  "141221",
  "112214",
  "112412",
  "122114",
  "122411",
  "142112",
  "142211",
  "241211",
  "221114",
  "413111",
  "241112",
  "134111",
  "111242",
  "121142",
  "121241",
  "114212",
  "124112",
  "124211",
  "411212",
  "421112",
  "421211",
  "212141",
  "214121",
  "412121",
  "111143",
  "111341",
  "131141",
  "114113",
  "114311",
  "411113",
  "411311",
  "113141",
  "114131",
  "311141",
  "411131",
  "211412",
  "211214",
  "211232",
  "2331112",
];
const CODE128_START_C = 105;
const CODE128_STOP = 106;

/** Encode an even-length numeric string as Code 128C modules (1 = bar). */
export function code128CModules(digits: string): number[] {
  const clean = digits.replace(/\D/g, "");
  const padded = clean.length % 2 === 0 ? clean : `0${clean}`;
  const values: number[] = [CODE128_START_C];
  for (let i = 0; i < padded.length; i += 2) {
    values.push(Number(padded.slice(i, i + 2)));
  }
  const checksum =
    values.reduce((acc, v, i) => acc + v * (i === 0 ? 1 : i), 0) % 103;
  values.push(checksum, CODE128_STOP);
  const modules: number[] = [];
  const quiet = 10;
  for (let i = 0; i < quiet; i++) modules.push(0);
  for (const v of values) {
    const pattern = CODE128_PATTERNS[v];
    let isBar = true;
    for (const ch of pattern) {
      const width = Number(ch);
      for (let w = 0; w < width; w++) modules.push(isBar ? 1 : 0);
      isBar = !isBar;
    }
  }
  for (let i = 0; i < quiet; i++) modules.push(0);
  return modules;
}

/** Total module count of a Code 128C encoding of `digits` (for sizing). */
export function code128CWidth(digits: string): number {
  return code128CModules(digits).length;
}

/** SHA-256 hex digest of `text` (Web Crypto; works in browser + Node 18+). */
export async function sha256Hex(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export interface PayslipSecurityInput {
  organizationName: string;
  employeeId: string;
  employeeName: string;
  period: string; // e.g. "JULY-2025"
  gross: number;
  deductions: number;
  nett: number;
  currency: string;
}

/** Canonical string that the document hash is computed over. */
export function canonicalPayslipString(i: PayslipSecurityInput): string {
  return [
    "FUELPRO-PAYSLIP",
    i.organizationName.trim().toUpperCase(),
    i.employeeId.trim(),
    i.employeeName.trim(),
    i.period,
    i.gross.toFixed(2),
    i.deductions.toFixed(2),
    i.nett.toFixed(2),
    i.currency,
  ].join("|");
}

/** The full 64-char SHA-256 document hash printed in the footer. */
export async function computePayslipDocHash(
  i: PayslipSecurityInput,
): Promise<string> {
  return sha256Hex(canonicalPayslipString(i));
}

/**
 * The QR payload — a compact, human-checkable verification string that
 * binds org + employee + period + amounts + the truncated doc hash, so a
 * scan of the QR proves the printed figures match the hashed document.
 */
export function buildPayslipVerifyPayload(
  i: PayslipSecurityInput,
  docHash: string,
): string {
  return [
    "FP-PAYSLIP",
    i.organizationName.trim().toUpperCase(),
    i.employeeId.trim(),
    i.period,
    `${i.currency}${i.nett.toFixed(2)}`,
    `H:${docHash.slice(0, 16).toUpperCase()}`,
  ].join("|");
}

/**
 * Even-length numeric code derived from the doc hash — used as the Code
 * 128C barcode content so the barcode is cryptographically bound to the
 * document (any changed figure changes the barcode).
 */
export function numericDocCode(docHash: string, digits = 14): string {
  const hex = docHash.replace(/[^0-9a-f]/gi, "").toLowerCase();
  let out = "";
  for (let i = 0; i < hex.length && out.length < digits; i += 2) {
    out += String(parseInt(hex.slice(i, i + 2), 16) % 10);
  }
  while (out.length < digits) out += "0";
  if (out.length % 2 !== 0) out += "0";
  return out;
}

/**
 * Resolve an employee record's display name. Payroll records are saved with
 * a single `fullName` (camelCase) / `full_name` (snake_case) field — NOT
 * separate first/last parts — so check full-name variants first, then
 * assemble from first/last parts, then any `name` field.
 */
export function resolveEmployeeName(e: {
  fullName?: string;
  full_name?: string;
  name?: string;
  firstName?: string;
  first_name?: string;
  lastName?: string;
  last_name?: string;
}): string {
  const full = (e.fullName || e.full_name || e.name || "").trim();
  if (full) return full;
  const parts = [e.firstName || e.first_name, e.lastName || e.last_name]
    .filter(Boolean)
    .join(" ")
    .trim();
  if (parts) return parts;
  return "Employee";
}

/**
 * The authorizing officer on a payslip is the NAME of whoever holds the
 * authorizing role in the station/company structure. Priority (most
 * payroll-specific first): payroll manager → HR / human resource →
 * accountant / finance → manager → owner. The payslip's own employee is
 * excluded (an employee cannot authorize their own payslip).
 */
export function resolveAuthorizingOfficer<
  T extends { employeeId?: string; role?: string; fullName?: string },
>(employees: T[], excludeEmployeeId?: string): T | null {
  const priorities = [
    "payroll manager",
    "payroll",
    "hr manager",
    "human resource",
    "hr",
    "accountant",
    "finance",
    "manager",
    "owner",
  ];
  let best: T | null = null;
  let bestRank = Infinity;
  for (const emp of employees) {
    if (excludeEmployeeId && emp.employeeId === excludeEmployeeId) continue;
    const role = String(emp.role || "").toLowerCase();
    if (!role.trim()) continue;
    const rank = priorities.findIndex((k) => role.includes(k));
    if (rank !== -1 && rank < bestRank) {
      bestRank = rank;
      best = emp;
    }
  }
  return best;
}
