import { supabase } from "@/supabase/client";
import { getBackendUrl } from "@/utils/apiConfig";

async function token(): Promise<string> {
  const { data } = await supabase.auth.getSession();
  if (!data.session?.access_token) throw new Error("Authentication required");
  return data.session.access_token;
}
async function request(
  path: string,
  body?: unknown,
  method: "GET" | "POST" = "POST",
) {
  const res = await fetch(`${getBackendUrl()}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${await token()}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data?.success === false)
    throw new Error(data?.error || `Request failed (${res.status})`);
  return data;
}
export async function canonicalCreatePurchaseOrder(input: {
  stationId: string;
  supplierId: string;
  orderNumber: string;
  currency?: string;
  items: Array<{
    productId?: string;
    fuelTypeId?: string;
    description: string;
    quantity: number;
    unitCost: number;
  }>;
}) {
  return request("/api/operations/suppliers?action=create-po", {
    stationId: input.stationId,
    supplierId: input.supplierId,
    orderNumber: input.orderNumber,
    currency: input.currency || "KES",
    items: input.items,
  });
}
export async function canonicalReceivePurchaseOrder(input: {
  stationId: string;
  purchaseOrderId: string;
  supplierId?: string;
  deliveryNote?: string;
  items: Array<{
    itemId?: string;
    productId?: string;
    fuelTypeId?: string;
    quantity: number;
    unitCost?: number;
  }>;
}) {
  return request("/api/operations/suppliers?action=receive", input);
}
export async function canonicalFetchPurchaseOrders(
  stationId: string,
  status?: string,
) {
  const q = new URLSearchParams({ stationId });
  if (status) q.set("status", status);
  const data = await request(
    `/api/operations/suppliers?${q}`,
    undefined,
    "GET",
  );
  return data.data || [];
}
