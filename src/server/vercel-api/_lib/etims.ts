export type EtimsMode = "OSCU" | "VSCU";

export function etimsConfig() {
  const baseUrl = (process.env.ETIMS_BASE_URL || "").replace(/\/$/, "");
  const invoicePath = process.env.ETIMS_INVOICE_PATH || "/trnsSales/saveSales";
  const tin = process.env.ETIMS_TIN || "";
  const bhfId = process.env.ETIMS_BRANCH_ID || "00";
  const deviceSerial = process.env.ETIMS_DEVICE_SERIAL || "";
  const authToken = process.env.ETIMS_AUTH_TOKEN || "";
  const mode = (process.env.ETIMS_MODE || "OSCU").toUpperCase() as EtimsMode;
  if (!baseUrl || !tin || !deviceSerial)
    throw new Error("eTIMS server configuration is incomplete");
  return { baseUrl, invoicePath, tin, bhfId, deviceSerial, authToken, mode };
}

export async function submitEtimsDocument(
  payload: unknown,
): Promise<{ ok: boolean; status: number; body: any }> {
  const c = etimsConfig();
  const res = await fetch(`${c.baseUrl}${c.invoicePath}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(c.authToken ? { authorization: `Bearer ${c.authToken}` } : {}),
    },
    body: JSON.stringify(payload),
  });
  let body: any = null;
  try {
    body = await res.json();
  } catch {
    body = { raw: await res.text().catch(() => null) };
  }
  return { ok: res.ok, status: res.status, body };
}

export function buildEtimsInvoice(input: {
  invoiceNumber: string;
  saleDate: string;
  customerPin?: string | null;
  customerName?: string | null;
  total: number;
  taxAmount: number;
  items: Array<{
    name: string;
    quantity: number;
    unitPrice: number;
    taxCode?: string;
  }>;
}) {
  const c = etimsConfig();
  return {
    tin: c.tin,
    bhfId: c.bhfId,
    deviceSerial: c.deviceSerial,
    mode: c.mode,
    invoiceNumber: input.invoiceNumber,
    saleDate: input.saleDate,
    customer: {
      pin: input.customerPin || null,
      name: input.customerName || null,
    },
    totals: {
      gross: input.total,
      tax: input.taxAmount,
      net: input.total - input.taxAmount,
      currency: "KES",
    },
    items: input.items.map((i, idx) => ({
      lineNumber: idx + 1,
      name: i.name,
      quantity: i.quantity,
      unitPrice: i.unitPrice,
      lineTotal: Number((i.quantity * i.unitPrice).toFixed(2)),
      taxCode: i.taxCode || "B",
    })),
  };
}
