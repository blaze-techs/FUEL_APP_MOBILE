/**
 * Integrations client (frontend)
 *
 * Calls the REAL integration dispatcher (/api/integrations). Host-aware:
 * on Vercel it uses the same-origin relative path; on Cloudflare Pages it
 * uses the same-origin path too (the Pages Function relays to Vercel).
 *
 * Every call reaches the actual institution when the station has configured
 * its own credentials in the Integration Hub. When credentials are missing,
 * the caller shows the honest "not configured" state — never a fake success.
 */

const VERCEL_API_ORIGIN = "https://fuel-app-mobile.vercel.app";

export function integrationsBase(): string {
  if (typeof window === "undefined") return VERCEL_API_ORIGIN;
  const host = window.location.hostname;
  // Same-origin works on both hosts (CF Pages Function relays to Vercel).
  if (host.endsWith("vercel.app") || host.endsWith("pages.dev")) return "";
  // Local dev: no functions runtime — call the production Vercel API.
  return VERCEL_API_ORIGIN;
}

export interface IntegrationResponse {
  success: boolean;
  error?: string;
  [key: string]: unknown;
}

export async function callIntegration(
  action: string,
  body: Record<string, unknown>,
): Promise<IntegrationResponse> {
  const res = await fetch(
    `${integrationsBase()}/api/integrations?action=${encodeURIComponent(action)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
  );
  const data = (await res.json().catch(() => ({}))) as IntegrationResponse;
  if (!res.ok && data.success === undefined) {
    return { success: false, error: `Integration API HTTP ${res.status}` };
  }
  return data;
}

// ─── Typed helpers ────────────────────────────────────────────────────────

export interface DarajaCredsInput {
  consumerKey: string;
  consumerSecret: string;
  passkey: string;
  shortcode: string;
  environment?: "sandbox" | "production";
}

export function darajaConfigured(
  c?: Partial<DarajaCredsInput> | null,
): boolean {
  return !!(c?.consumerKey && c?.consumerSecret && c?.passkey && c?.shortcode);
}

export async function mpesaStkPush(
  creds: DarajaCredsInput,
  req: {
    phoneNumber: string;
    amount: number;
    accountReference?: string;
    transactionDesc?: string;
  },
): Promise<IntegrationResponse> {
  return callIntegration("mpesa-stk-push", { creds, ...req });
}

export async function mpesaStkQuery(
  creds: DarajaCredsInput,
  checkoutRequestId: string,
): Promise<IntegrationResponse> {
  return callIntegration("mpesa-query", { creds, checkoutRequestId });
}

export interface KopokopoCredsInput {
  clientId: string;
  clientSecret: string;
  tillNumber: string;
  environment?: "sandbox" | "production";
}

export function kopokopoConfigured(
  c?: Partial<KopokopoCredsInput> | null,
): boolean {
  return !!(c?.clientId && c?.clientSecret);
}

export async function kopokopoPull(
  creds: KopokopoCredsInput,
): Promise<IntegrationResponse> {
  return callIntegration("kopokopo-pull", { creds });
}

export interface PayheroCredsInput {
  apiUsername: string;
  apiPassword: string;
  channelId: string;
  accountReference?: string;
}

export function payheroConfigured(
  c?: Partial<PayheroCredsInput> | null,
): boolean {
  return !!(c?.apiUsername && c?.apiPassword && c?.channelId);
}

export async function payheroStkPush(
  creds: PayheroCredsInput,
  req: {
    phoneNumber: string;
    amount: number;
    customerName?: string;
    transactionDesc?: string;
  },
): Promise<IntegrationResponse> {
  return callIntegration("payhero-stk-push", { creds, ...req });
}

export async function payheroQueryStatus(
  creds: PayheroCredsInput,
  reference: string,
): Promise<IntegrationResponse> {
  return callIntegration("payhero-status", { creds, reference });
}

export async function payheroListChannels(
  creds: Pick<PayheroCredsInput, "apiUsername" | "apiPassword">,
): Promise<IntegrationResponse> {
  return callIntegration("payhero-channels", { creds });
}

export async function payheroWalletBalance(
  creds: Pick<PayheroCredsInput, "apiUsername" | "apiPassword">,
): Promise<IntegrationResponse> {
  return callIntegration("payhero-wallet", { creds });
}

export interface EtimsCredsInput {
  tin: string;
  bhfId: string;
  cmcKey: string;
  environment?: "sandbox" | "production";
}

export function etimsConfigured(c?: Partial<EtimsCredsInput> | null): boolean {
  return !!(c?.tin && c?.bhfId && c?.cmcKey);
}

export async function kraEtimsInit(
  creds: EtimsCredsInput,
): Promise<IntegrationResponse> {
  return callIntegration("kra-etims-init", { creds });
}

export async function kraEtimsInvoice(
  creds: EtimsCredsInput,
  invoice: {
    custTin?: string;
    custNm?: string;
    trdInvcNo: string;
    items: Array<{
      itemNm: string;
      qty: number;
      prc: number;
      taxTyCd?: string;
    }>;
    paymentType?: string;
  },
): Promise<IntegrationResponse> {
  return callIntegration("kra-etims-invoice", { creds, ...invoice });
}

export async function fireWebhook(
  url: string,
  event: string,
  payload: Record<string, unknown>,
  secret?: string,
): Promise<IntegrationResponse> {
  return callIntegration("webhook-fire", { url, event, payload, secret });
}
