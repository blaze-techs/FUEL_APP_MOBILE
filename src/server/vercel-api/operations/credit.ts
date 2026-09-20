import {
  authenticate,
  errorResponse,
  json,
  requirePermission,
} from "../_lib/authz.js";
import { supabaseAdmin } from "../_lib/supabase-admin.js";

async function balance(accountId: string) {
  if (!supabaseAdmin) return 0;
  const { data, error } = await supabaseAdmin
    .from("credit_ledger")
    .select("amount")
    .eq("account_id", accountId);
  if (error) throw new Error(error.message);
  return (data || []).reduce(
    (s: number, r: any) => s + Number(r.amount || 0),
    0,
  );
}
export async function POST(request: Request): Promise<Response> {
  try {
    if (!supabaseAdmin)
      throw Object.assign(new Error("Server unavailable"), { status: 500 });
    const ctx = await authenticate(request);
    const body: any = await request.json();
    const action = new URL(request.url).searchParams.get("action") || "";
    const stationId = String(body.stationId || "");
    await requirePermission(ctx, stationId, "credit.manage");
    if (action === "account") {
      const { data, error } = await supabaseAdmin
        .from("credit_accounts_ledger")
        .insert({
          station_id: stationId,
          customer_id: body.customerId || null,
          account_name: body.accountName,
          account_type: body.accountType || "customer",
          external_ref: body.externalRef || null,
          credit_limit: Number(body.creditLimit || 0),
          status: "active",
          created_by: ctx.userId,
        })
        .select("*")
        .single();
      if (error) throw new Error(error.message);
      return json({ success: true, data });
    }
    if (action === "charge") {
      const { data: acct } = await supabaseAdmin
        .from("credit_accounts_ledger")
        .select("*")
        .eq("id", body.accountId)
        .eq("station_id", stationId)
        .maybeSingle();
      if (!acct)
        throw Object.assign(new Error("Credit account not found"), {
          status: 404,
        });
      const current = await balance(acct.id);
      const amount = Math.abs(Number(body.amount));
      if (current + amount > Number(acct.credit_limit))
        throw Object.assign(new Error("Credit limit exceeded"), {
          status: 409,
        });
      const { data, error } = await supabaseAdmin
        .from("credit_ledger")
        .insert({
          station_id: stationId,
          account_id: acct.id,
          entry_type: "charge",
          amount,
          sale_id: body.saleId || null,
          vehicle_ref: body.vehicleRef || null,
          description: body.description || "Credit sale",
          created_by: ctx.userId,
        })
        .select("*")
        .single();
      if (error) throw new Error(error.message);
      return json({ success: true, data, balance: current + amount });
    }
    if (action === "payment") {
      const amount = Math.abs(Number(body.amount));
      const { data, error } = await supabaseAdmin
        .from("credit_ledger")
        .insert({
          station_id: stationId,
          account_id: body.accountId,
          entry_type: "payment",
          amount: -amount,
          payment_id: body.paymentId || null,
          description: body.description || "Credit payment",
          created_by: ctx.userId,
        })
        .select("*")
        .single();
      if (error) throw new Error(error.message);
      return json({
        success: true,
        data,
        balance: await balance(body.accountId),
      });
    }
    return json({ success: false, error: "Unknown action" }, 400);
  } catch (e) {
    return errorResponse(e);
  }
}
export async function GET(request: Request): Promise<Response> {
  try {
    if (!supabaseAdmin) throw new Error("Server unavailable");
    const ctx = await authenticate(request);
    const url = new URL(request.url);
    const stationId = String(url.searchParams.get("stationId") || "");
    const accountId = String(url.searchParams.get("accountId") || "");
    await requirePermission(ctx, stationId, "report.read");
    const { data: account, error: aerr } = await supabaseAdmin
      .from("credit_accounts_ledger")
      .select("*")
      .eq("id", accountId)
      .eq("station_id", stationId)
      .maybeSingle();
    if (aerr || !account)
      throw Object.assign(new Error(aerr?.message || "Account not found"), {
        status: 404,
      });
    const { data: entries, error } = await supabaseAdmin
      .from("credit_ledger")
      .select("*")
      .eq("account_id", accountId)
      .order("created_at", { ascending: true });
    if (error) throw new Error(error.message);
    let running = 0;
    const statement = (entries || []).map((e: any) => ({
      ...e,
      running_balance: (running += Number(e.amount || 0)),
    }));
    return json({ success: true, account, balance: running, statement });
  } catch (e) {
    return errorResponse(e);
  }
}
