import {
  authenticate,
  errorResponse,
  json,
  requirePermission,
} from "../_lib/authz.js";
import { buildEtimsInvoice, submitEtimsDocument } from "../_lib/etims.js";
import { supabaseAdmin } from "../_lib/supabase-admin.js";

export async function POST(request: Request): Promise<Response> {
  try {
    if (!supabaseAdmin)
      throw Object.assign(new Error("Server unavailable"), { status: 500 });
    const ctx = await authenticate(request);
    const body: any = await request.json();
    const saleId = String(body.saleId || "");
    const { data: sale, error } = await supabaseAdmin
      .from("sales_ledger")
      .select("*")
      .eq("id", saleId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!sale)
      throw Object.assign(new Error("Sale not found"), { status: 404 });
    await requirePermission(ctx, sale.station_id, "report.read");

    const localReference = String(
      body.localReference || sale.receipt_number || sale.id,
    );
    const payload = buildEtimsInvoice({
      invoiceNumber: localReference,
      saleDate: new Date(sale.created_at).toISOString(),
      customerPin: body.customerPin || null,
      customerName: body.customerName || null,
      total: Number(sale.gross_amount),
      taxAmount: Number(sale.tax_amount),
      items: body.items?.length
        ? body.items
        : [
            {
              name: body.itemName || "Fuel",
              quantity: Number(sale.quantity_litres),
              unitPrice: Number(sale.unit_price),
              taxCode: body.taxCode,
            },
          ],
    });

    const { data: doc, error: insertError } = await supabaseAdmin
      .from("etims_documents")
      .upsert(
        {
          station_id: sale.station_id,
          sale_id: sale.id,
          document_type:
            sale.entry_type === "reversal" ? "credit_note" : "invoice",
          local_reference: localReference,
          status: "pending",
          request_payload: payload,
        },
        { onConflict: "station_id,local_reference" },
      )
      .select("*")
      .single();
    if (insertError) throw new Error(insertError.message);

    const result = await submitEtimsDocument(payload);
    const accepted =
      result.ok &&
      !["ERROR", "FAILED", "REJECTED"].includes(
        String(result.body?.status || "").toUpperCase(),
      );
    await supabaseAdmin
      .from("etims_documents")
      .update({
        status: accepted ? "accepted" : "rejected",
        kra_reference:
          result.body?.receiptNo ||
          result.body?.invoiceNo ||
          result.body?.data?.receiptNo ||
          null,
        response_payload: result.body,
        submitted_at: new Date().toISOString(),
        accepted_at: accepted ? new Date().toISOString() : null,
        last_error: accepted
          ? null
          : result.body?.message || `HTTP ${result.status}`,
      })
      .eq("id", doc.id);

    return json(
      { success: accepted, documentId: doc.id, response: result.body },
      accepted ? 200 : 502,
    );
  } catch (e) {
    return errorResponse(e);
  }
}
