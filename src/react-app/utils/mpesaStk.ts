import { getBackendUrl } from "@/utils/apiConfig";
import { supabase } from "@/supabase/client";

const API_URL = getBackendUrl();
const CURRENT_STATION_KEY = "fuelpro_current_station_v3";

export interface DarajaConfig {
  consumerKey: string;
  consumerSecret: string;
  passkey: string;
  businessShortCode: string;
  callbackUrl: string;
  environment: "sandbox" | "production";
}

export interface STKPushRequest {
  phoneNumber: string;
  amount: number;
  accountReference: string;
  transactionDesc?: string;
  stationId?: string;
  saleId?: string;
  idempotencyKey?: string;
}

export interface STKPushResponse {
  success: boolean;
  merchantRequestId?: string;
  checkoutRequestId?: string;
  responseCode?: string;
  responseDescription?: string;
  customerMessage?: string;
  transactionId?: string;
  duplicate?: boolean;
  error?: string;
}

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

async function authToken(): Promise<string> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token)
    throw new Error("Your session has expired. Please sign in again.");
  return token;
}

function resolveStationId(explicit?: string): string {
  if (explicit) return explicit;
  const cached = localStorage.getItem(CURRENT_STATION_KEY);
  if (cached) return cached;
  throw new Error("Select a station before starting an M-Pesa transaction.");
}

function storePendingTransaction(
  checkoutRequestId: string,
  merchantRequestId: string,
  request: STKPushRequest,
) {
  try {
    const pending: PendingTransaction[] = JSON.parse(
      localStorage.getItem("fuelpro_mpesa_pending") || "[]",
    );
    pending.unshift({
      checkoutRequestId,
      merchantRequestId,
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
  } catch (error) {
    console.warn(
      "[MpesaStk] Could not update local pending-payment cache:",
      error,
    );
  }
}

export async function initiateSTKPush(
  request: STKPushRequest,
  _legacyConfig?: Partial<DarajaConfig>,
): Promise<STKPushResponse> {
  try {
    const phone = formatPhone254(request.phoneNumber);
    if (!/^254(?:7|1)\d{8}$/.test(phone)) {
      return { success: false, error: "Invalid Kenyan mobile number." };
    }
    if (!Number.isFinite(request.amount) || request.amount < 1) {
      return { success: false, error: "Amount must be at least KES 1." };
    }

    const response = await fetch(`${API_URL}/api/mpesa/stkpush`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${await authToken()}`,
      },
      body: JSON.stringify({
        stationId: resolveStationId(request.stationId),
        saleId: request.saleId || null,
        phoneNumber: phone,
        amount: request.amount,
        accountReference: request.accountReference || "FuelPro",
        description: request.transactionDesc || "Fuel purchase",
        idempotencyKey: request.idempotencyKey || crypto.randomUUID(),
      }),
    });

    const data = await response.json();
    if (!response.ok || !data.success) {
      return { success: false, error: data.error || "M-Pesa STK Push failed." };
    }

    storePendingTransaction(
      data.checkoutRequestId,
      data.merchantRequestId || "",
      request,
    );
    return {
      success: true,
      transactionId: data.transactionId,
      merchantRequestId: data.merchantRequestId,
      checkoutRequestId: data.checkoutRequestId,
      responseDescription: data.responseDescription,
      customerMessage: data.customerMessage,
      duplicate: data.duplicate,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "M-Pesa request failed.",
    };
  }
}

export async function querySTKStatus(
  checkoutRequestId: string,
  _legacyConfig?: Partial<DarajaConfig>,
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
  try {
    const response = await fetch(`${API_URL}/api/mpesa/stkstatus`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${await authToken()}`,
      },
      body: JSON.stringify({ checkoutRequestId }),
    });
    const data = await response.json();
    if (!response.ok || !data.success) {
      return { success: false, error: data.error || "Status query failed." };
    }
    const tx = data.localTransaction;
    const paid = tx?.status === "confirmed";
    return {
      success: true,
      resultCode: tx?.result_code ?? (paid ? "0" : undefined),
      resultDesc: tx?.result_description ?? tx?.status,
      paid,
      amount: tx?.amount == null ? undefined : Number(tx.amount),
      mpesaReceipt: tx?.mpesa_receipt || undefined,
      phone: tx?.customer_phone || tx?.metadata?.callback_phone || undefined,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Status query failed.",
    };
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
    const pending = getPendingTransactions();
    localStorage.setItem(
      "fuelpro_mpesa_pending",
      JSON.stringify(
        pending.map((tx) =>
          tx.checkoutRequestId === checkoutRequestId
            ? { ...tx, status, ...details }
            : tx,
        ),
      ),
    );
  } catch (error) {
    console.warn("[MpesaStk] Could not update local transaction cache:", error);
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
  } catch (error) {
    console.warn(
      "[MpesaStk] Could not update local transaction history:",
      error,
    );
  }
}

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

/**
 * UI cache helper only. The authoritative callback reconciliation happens in
 * /api/mpesa/callback and payment_transactions.
 */
export function handleMpesacallback(payload: MpesacallbackPayload): {
  success: boolean;
  receipt?: string;
} {
  const { stkCallback } = payload.Body;
  const paid = stkCallback.ResultCode === 0;
  const receipt = stkCallback.CallbackMetadata?.Item?.find(
    (item) => item.Name === "MpesaReceiptNumber",
  )?.Value as string | undefined;

  updateTransactionStatus(
    stkCallback.CheckoutRequestID,
    paid ? "success" : "failed",
    {
      resultCode: String(stkCallback.ResultCode),
      resultDesc: stkCallback.ResultDesc,
      mpesaReceipt: receipt,
    },
  );
  return { success: paid, receipt };
}

export function formatPhone254(phone: string): string {
  const clean = phone.replace(/\D/g, "");
  if (/^0(?:7|1)\d{8}$/.test(clean)) return `254${clean.slice(1)}`;
  if (/^(?:7|1)\d{8}$/.test(clean)) return `254${clean}`;
  if (/^254(?:7|1)\d{8}$/.test(clean)) return clean;
  return clean;
}

/**
 * Browser code intentionally cannot inspect M-Pesa secrets anymore.
 * Configuration health is validated by the server when an STK request is made.
 */
export function validateMpesaCredentials(): {
  valid: boolean;
  missing: string[];
} {
  return { valid: true, missing: [] };
}

export function getMpesaConfig(): DarajaConfig {
  return {
    consumerKey: "",
    consumerSecret: "",
    passkey: "",
    businessShortCode: "",
    callbackUrl: "/api/mpesa/callback",
    environment: "production",
  };
}
