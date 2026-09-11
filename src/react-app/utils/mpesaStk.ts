// ═══════════════════════════════════════════════════
// M-PESA STK PUSH - Server-Side Implementation
// ═══════════════════════════════════════════════════
//
// SECURITY FIX: Previously this file called Safaricom's Daraja API directly
// from the browser with credentials from localStorage. This exposed M-PESA
// API credentials to anyone with browser devtools access.
//
// Now we use our backend server (/api/mpesa/stkpush) which:
// 1. Holds M-PESA credentials securely in environment variables
// 2. Creates PENDING transaction records for callback verification
// 3. Returns only the checkout request ID to the client
//
// The backend fallback (for backwards compatibility) is kept for development
// only when the backend is unavailable.

import { getBackendUrl } from "@/utils/apiConfig";

const API_URL = getBackendUrl();

interface DarajaConfig {
  consumerKey: string;
  consumerSecret: string;
  passkey: string;
  businessShortCode: string;
  callbackUrl: string;
  environment: "sandbox" | "production";
}

// Load config from company settings (legacy - for fallback only)
function loadConfig(): DarajaConfig {
  try {
    const companyRaw = localStorage.getItem("fuelpro_company_v1");
    if (companyRaw) {
      const company = JSON.parse(companyRaw);
      const apiKeys = company.settings?.apiKeys || {};
      return {
        consumerKey: apiKeys.mpesaConsumerKey || "",
        consumerSecret: apiKeys.mpesaConsumerSecret || "",
        passkey: apiKeys.mpesaPasskey || "",
        businessShortCode: apiKeys.mpesaShortCode || "174379",
        callbackUrl:
          apiKeys.mpesaCallbackUrl || "https://fuelpro.app/api/mpesa/callback",
        environment: apiKeys.mpesaEnvironment || "production",
      };
    }
  } catch (err) {
    console.warn("[MpesaStk] Failed to load M-Pesa config from storage:", err);
  }
  return {
    consumerKey: "",
    consumerSecret: "",
    passkey: "",
    businessShortCode: "174379",
    callbackUrl: "https://fuelpro.app/api/mpesa/callback",
    environment: "production",
  };
}

// Get auth token from founder session
function getAuthToken(): string | null {
  try {
    const token = localStorage.getItem("fuelpro_auth_token");
    if (token) return token;

    const sessionJson = localStorage.getItem("fuelpro_founder_session");
    if (sessionJson) {
      const session = JSON.parse(sessionJson);
      if (
        session.active &&
        session.token &&
        Date.now() - session.loginTime < 8 * 60 * 60 * 1000
      ) {
        return session.token;
      }
    }
    return null;
  } catch {
    return null;
  }
}

// Generate password for STK push (legacy fallback)
function generatePassword(config: DarajaConfig): string {
  const timestamp = new Date()
    .toISOString()
    .replace(/[^0-9]/g, "")
    .slice(0, 14);
  const passwordString = `${config.businessShortCode}${config.passkey}${timestamp}`;
  return btoa(passwordString);
}

// ═══════════════════════════════════════════════════
// STEP 1: Get OAuth Access Token (legacy fallback)
// ═══════════════════════════════════════════════════
async function getAccessTokenLegacy(config: DarajaConfig): Promise<string> {
  const baseUrl =
    config.environment === "production"
      ? "https://api.safaricom.co.ke"
      : "https://sandbox.safaricom.co.ke";

  const auth = btoa(`${config.consumerKey}:${config.consumerSecret}`);

  const response = await fetch(
    `${baseUrl}/oauth/v1/generate?grant_type=client_credentials`,
    {
      method: "GET",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/json",
      },
    },
  );

  if (!response.ok) {
    throw new Error(`Auth failed: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();
  if (!data.access_token) {
    throw new Error("No access token in response");
  }
  return data.access_token;
}

// ═══════════════════════════════════════════════════
// STEP 2: Initiate STK Push (Lipa na M-Pesa Online)
// ═══════════════════════════════════════════════════
export interface STKPushRequest {
  phoneNumber: string; // 2547XXXXXXXX format
  amount: number;
  accountReference: string; // e.g., "FUELPRO001"
  transactionDesc?: string;
}

export interface STKPushResponse {
  success: boolean;
  merchantRequestId?: string;
  checkoutRequestId?: string;
  responseCode?: string;
  responseDescription?: string;
  customerMessage?: string;
  error?: string;
}

export async function initiateSTKPush(
  request: STKPushRequest,
  _config?: Partial<DarajaConfig>, // Kept for backwards compatibility
): Promise<STKPushResponse> {
  // Validate phone format
  const cleanPhone = request.phoneNumber.replace(/\D/g, "");
  if (!/^2547\d{8}$/.test(cleanPhone)) {
    return {
      success: false,
      error:
        "Invalid phone number. Use format: 2547XXXXXXXX (e.g., 254712345678)",
    };
  }

  // Validate amount
  if (request.amount < 1) {
    return { success: false, error: "Amount must be at least KES 1" };
  }

  // Try server-side implementation first
  try {
    const authToken = getAuthToken();
    if (authToken) {
      const response = await fetch(`${API_URL}/api/mpesa/stkpush`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify({
          phoneNumber: request.phoneNumber,
          amount: request.amount,
          accountReference: request.accountReference,
          description: request.transactionDesc || "Fuel purchase",
        }),
      });

      const data = await response.json();

      if (data.success) {
        // Store locally for UI tracking
        storePendingTransaction(data.checkoutRequestId, request);

        return {
          success: true,
          checkoutRequestId: data.checkoutRequestId,
          responseDescription:
            data.responseDescription || "Request sent successfully",
        };
      } else {
        return {
          success: false,
          error: data.error || "Server-side STK push failed",
        };
      }
    }
  } catch (err) {
    console.warn(
      "Backend STK push unavailable, falling back to client-side:",
      err,
    );
  }

  // Legacy fallback: direct Safaricom API call (development only)
  console.warn(
    "Using legacy client-side M-PESA - credentials will be exposed in browser",
  );
  const fullConfig = loadConfig();

  if (
    !fullConfig.consumerKey ||
    !fullConfig.consumerSecret ||
    !fullConfig.passkey
  ) {
    return {
      success: false,
      error: "M-Pesa credentials not configured. Please contact support.",
    };
  }

  try {
    const accessToken = await getAccessTokenLegacy(fullConfig);
    const baseUrl =
      fullConfig.environment === "production"
        ? "https://api.safaricom.co.ke"
        : "https://sandbox.safaricom.co.ke";
    const timestamp = new Date()
      .toISOString()
      .replace(/[^0-9]/g, "")
      .slice(0, 14);

    const response = await fetch(`${baseUrl}/mpesa/stkpush/v1/processrequest`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        BusinessShortCode: fullConfig.businessShortCode,
        Password: generatePassword(fullConfig),
        Timestamp: timestamp,
        TransactionType: "CustomerPayBillOnline",
        Amount: Math.round(request.amount),
        PartyA: cleanPhone,
        PartyB: fullConfig.businessShortCode,
        PhoneNumber: cleanPhone,
        CallBackURL: fullConfig.callbackUrl,
        AccountReference: request.accountReference || "FuelPro",
        TransactionDesc: request.transactionDesc || "Fuel purchase",
      }),
    });

    const data = await response.json();

    if (data.ResponseCode === "0") {
      storePendingTransaction(data.CheckoutRequestID, request);
      return {
        success: true,
        merchantRequestId: data.MerchantRequestID,
        checkoutRequestId: data.CheckoutRequestID,
        responseCode: data.ResponseCode,
        responseDescription: data.ResponseDescription,
        customerMessage: data.CustomerMessage,
      };
    }

    return {
      success: false,
      responseCode: data.ResponseCode,
      responseDescription: data.ResponseDescription,
      error: data.errorMessage || data.ResponseDescription || "STK Push failed",
    };
  } catch (err: any) {
    return {
      success: false,
      error:
        err.message || "Network error. Please check your internet connection.",
    };
  }
}

// ═══════════════════════════════════════════════════
// STEP 3: Query STK Push Status
// ═══════════════════════════════════════════════════
export async function querySTKStatus(
  checkoutRequestId: string,
  _config?: Partial<DarajaConfig>,
): Promise<{
  success: boolean;
  resultCode?: string;
  resultDesc?: string;
  paid?: boolean;
  amount?: number;
  mpesaReceipt?: string;
  phone?: string;
  error?: string;
}> {
  // Try server-side first
  try {
    const authToken = getAuthToken();
    if (authToken) {
      const response = await fetch(`${API_URL}/api/mpesa/stkstatus`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify({ checkoutRequestId }),
      });

      const data = await response.json();
      if (data.success && data.localTransaction) {
        const tx = data.localTransaction;
        return {
          success: true,
          resultCode: tx.status === "PAID" ? "0" : "1",
          resultDesc: tx.status,
          paid: tx.status === "PAID",
          amount: tx.amount,
          mpesaReceipt: tx.mpesa_receipt,
          phone: tx.phone,
        };
      }
    }
  } catch (err) {
    console.warn("Backend STK status unavailable:", err);
  }

  // Legacy fallback
  const fullConfig = loadConfig();
  if (!fullConfig.consumerKey || !fullConfig.consumerSecret) {
    return { success: false, error: "Credentials not configured" };
  }

  try {
    const accessToken = await getAccessTokenLegacy(fullConfig);
    const baseUrl =
      fullConfig.environment === "production"
        ? "https://api.safaricom.co.ke"
        : "https://sandbox.safaricom.co.ke";
    const timestamp = new Date()
      .toISOString()
      .replace(/[^0-9]/g, "")
      .slice(0, 14);

    const response = await fetch(`${baseUrl}/mpesa/stkpushquery/v1/query`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        BusinessShortCode: fullConfig.businessShortCode,
        Password: generatePassword(fullConfig),
        Timestamp: timestamp,
        CheckoutRequestID: checkoutRequestId,
      }),
    });

    const data = await response.json();

    if (data.ResultCode === "0") {
      return {
        success: true,
        resultCode: data.ResultCode,
        resultDesc: data.ResultDesc,
        paid: true,
        amount: data.CallbackMetadata?.Item?.find(
          (i: any) => i.Name === "Amount",
        )?.Value,
        mpesaReceipt: data.CallbackMetadata?.Item?.find(
          (i: any) => i.Name === "MpesaReceiptNumber",
        )?.Value,
        phone: data.CallbackMetadata?.Item?.find(
          (i: any) => i.Name === "PhoneNumber",
        )?.Value?.toString(),
      };
    }

    return {
      success: true,
      resultCode: data.ResultCode,
      resultDesc: data.ResultDesc,
      paid: false,
    };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

// ═══════════════════════════════════════════════════
// Pending Transaction Store
// ═══════════════════════════════════════════════════
interface PendingTransaction {
  checkoutRequestId: string;
  merchantRequestId: string;
  phoneNumber: string;
  amount: number;
  accountReference: string;
  status: "pending" | "success" | "failed" | "cancelled";
  timestamp: string;
  resultCode?: string;
  resultDesc?: string;
  mpesaReceipt?: string;
}

function storePendingTransaction(
  checkoutRequestId: string,
  request: STKPushRequest,
) {
  try {
    const pending: PendingTransaction[] = JSON.parse(
      localStorage.getItem("fuelpro_mpesa_pending") || "[]",
    );
    pending.unshift({
      checkoutRequestId,
      merchantRequestId: "",
      phoneNumber: request.phoneNumber,
      amount: request.amount,
      accountReference: request.accountReference || "FuelPro",
      status: "pending",
      timestamp: new Date().toISOString(),
    });
    localStorage.setItem(
      "fuelpro_mpesa_pending",
      JSON.stringify(pending.slice(0, 100)),
    );
  } catch (err) {
    console.warn("[MpesaStk] Failed to store pending transaction:", err);
  }
}

export function getPendingTransactions(): PendingTransaction[] {
  try {
    return JSON.parse(localStorage.getItem("fuelpro_mpesa_pending") || "[]");
  } catch {
    return [];
  }
}

export function updateTransactionStatus(
  checkoutRequestId: string,
  status: PendingTransaction["status"],
  details?: { resultCode?: string; resultDesc?: string; mpesaReceipt?: string },
) {
  try {
    const pending: PendingTransaction[] = JSON.parse(
      localStorage.getItem("fuelpro_mpesa_pending") || "[]",
    );
    const updated = pending.map((tx) =>
      tx.checkoutRequestId === checkoutRequestId
        ? { ...tx, status, ...details }
        : tx,
    );
    localStorage.setItem("fuelpro_mpesa_pending", JSON.stringify(updated));
  } catch (err) {
    console.warn("[MpesaStk] Failed to update transaction status:", err);
  }
}

export function getTransactionHistory(): PendingTransaction[] {
  try {
    return JSON.parse(localStorage.getItem("fuelpro_mpesa_history") || "[]");
  } catch {
    return [];
  }
}

export function addToHistory(tx: PendingTransaction) {
  try {
    const history = getTransactionHistory();
    history.unshift(tx);
    localStorage.setItem(
      "fuelpro_mpesa_history",
      JSON.stringify(history.slice(0, 500)),
    );
  } catch (err) {
    console.warn("[MpesaStk] Failed to add transaction to history:", err);
  }
}

// ═══════════════════════════════════════════════════
// Callback Handler (receives from Safaricom server)
// ═══════════════════════════════════════════════════
export interface MpesacallbackPayload {
  Body: {
    stkCallback: {
      MerchantRequestID: string;
      CheckoutRequestID: string;
      ResultCode: number;
      ResultDesc: string;
      CallbackMetadata?: {
        Item: { Name: string; Value: string | number }[];
      };
    };
  };
}

export function handleMpesacallback(payload: MpesacallbackPayload): {
  success: boolean;
  receipt?: string;
} {
  const { stkCallback } = payload.Body;
  const paid = stkCallback.ResultCode === 0;

  const receipt = stkCallback.CallbackMetadata?.Item?.find(
    (i: any) => i.Name === "MpesaReceiptNumber",
  )?.Value as string;

  updateTransactionStatus(
    stkCallback.CheckoutRequestID,
    paid ? "success" : "failed",
    {
      resultCode: String(stkCallback.ResultCode),
      resultDesc: stkCallback.ResultDesc,
      mpesaReceipt: receipt,
    },
  );

  // Move to history
  const pending = getPendingTransactions();
  const tx = pending.find(
    (t) => t.checkoutRequestId === stkCallback.CheckoutRequestID,
  );
  if (tx) {
    addToHistory({
      ...tx,
      status: paid ? "success" : "failed",
      mpesaReceipt: receipt,
    });
  }

  return { success: paid, receipt };
}

// ═══════════════════════════════════════════════════
// Helper: Format phone for display
// FIX: Removed unreachable code - clean.remove(/\D/g) removes +, so clean can never start with "+254"
// ═══════════════════════════════════════════════════
export function formatPhone254(phone: string): string {
  const clean = phone.replace(/\D/g, "");

  // 07xx xxx xxx -> 254xxxxxxxxx
  if (clean.startsWith("0") && clean.length === 10) {
    return "254" + clean.slice(1);
  }

  // 254xxxxxxxxxx (already correct format)
  if (clean.startsWith("254") && clean.length === 12) {
    return clean;
  }

  // Already 254xxxxxxxxxx without leading 0
  if (clean.length === 11 && clean.startsWith("254")) {
    return clean;
  }

  // 7xx xxx xxx -> 254xxxxxxxxx
  if (clean.startsWith("7") && clean.length === 9) {
    return "254" + clean;
  }

  return clean; // Return as-is if already correct
}

// ═══════════════════════════════════════════════════
// Helper: Validate M-Pesa credentials
// ═══════════════════════════════════════════════════
export function validateMpesaCredentials(): {
  valid: boolean;
  missing: string[];
} {
  const config = loadConfig();
  const missing: string[] = [];
  if (!config.consumerKey) missing.push("Consumer Key");
  if (!config.consumerSecret) missing.push("Consumer Secret");
  if (!config.passkey) missing.push("Passkey");
  if (!config.businessShortCode) missing.push("Business Short Code");
  return { valid: missing.length === 0, missing };
}

export { loadConfig as getMpesaConfig };
export type { DarajaConfig };
