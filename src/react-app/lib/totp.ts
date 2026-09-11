// ============================================================
// TOTP 2FA Utilities - Time-based One-Time Password
// Uses HMAC-SHA1 simulation for client-side 2FA
// ============================================================

const BASE32_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

/** Generate a random Base32 secret (32 chars) */
export function genSecret(): string {
  let secret = "";
  const arr = new Uint8Array(20);
  crypto.getRandomValues(arr);
  for (let i = 0; i < arr.length; i++) {
    secret += BASE32_CHARS[arr[i] % 32];
  }
  return secret;
}

/** Convert base32 string to Uint8Array */
function base32Decode(secret: string): Uint8Array {
  const bits = secret
    .toUpperCase()
    .replace(/[^A-Z2-7]/g, "")
    .split("")
    .map((c) => BASE32_CHARS.indexOf(c).toString(2).padStart(5, "0"))
    .join("");
  const bytes: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    bytes.push(parseInt(bits.substring(i, i + 8), 2));
  }
  return new Uint8Array(bytes);
}

/** Generate HMAC-SHA1 (simplified for client-side use) */
async function hmacSha1(
  key: Uint8Array,
  data: Uint8Array,
): Promise<Uint8Array> {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    key as BufferSource,
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", cryptoKey, data as BufferSource);
  return new Uint8Array(sig);
}

/** Generate TOTP code from secret at given time step */
export async function genCode(
  secret: string,
  timestamp?: number,
): Promise<string> {
  const step = Math.floor((timestamp || Date.now()) / 30000);
  const key = base32Decode(secret);

  // Counter to 8-byte big-endian
  const counter = new Uint8Array(8);
  let temp = step;
  for (let i = 7; i >= 0; i--) {
    counter[i] = temp & 0xff;
    temp >>= 8;
  }

  const hmac = await hmacSha1(key, counter);
  const offset = hmac[hmac.length - 1] & 0x0f;
  const code =
    (((hmac[offset] & 0x7f) << 24) |
      ((hmac[offset + 1] & 0xff) << 16) |
      ((hmac[offset + 2] & 0xff) << 8) |
      (hmac[offset + 3] & 0xff)) %
    1000000;
  return code.toString().padStart(6, "0");
}

/** Verify a TOTP code with window of +/- 1 step */
export async function verifyCode(
  secret: string,
  code: string,
): Promise<boolean> {
  const now = Date.now();
  for (let i = -1; i <= 1; i++) {
    const expected = await genCode(secret, now + i * 30000);
    if (expected === code) return true;
  }
  return false;
}

/** Generate OTPAuth URI for QR code */
export function qrData(secret: string, label: string): string {
  const encodedLabel = encodeURIComponent(label);
  return `otpauth://totp/FuelPro:${encodedLabel}?secret=${secret}&issuer=FuelPro&algorithm=SHA1&digits=6&period=30`;
}

/** Generate a setup key display (grouped by 4) */
export function formatSecret(secret: string): string {
  return secret.replace(/(.{4})/g, "$1 ").trim();
}
