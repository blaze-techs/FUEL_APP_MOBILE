/**
 * pos-service.ts
 * Central POS checkout + stock-movement engine.
 * Every sale, adjustment, transfer, count, wastage, and PO-receipt writes
 * an inventory_transactions row and keeps products.stock_quantity in sync.
 * All inserts set owner_id from the Supabase session (UPDATE-22 RLS).
 */
import { supabase } from "@/supabase/client";
import { useStations } from "@/react-app/context/StationContext";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface POSItem {
  productId: string;
  name: string;
  sku: string;
  quantity: number;
  unitPrice: number;
  discountPercent: number;
  taxRate: number;
  taxAmount: number;
  totalAmount: number;
}

export interface POSCart {
  items: POSItem[];
  subtotal: number;
  taxAmount: number;
  discountAmount: number;
  totalAmount: number;
}

export interface SaleResult {
  success: boolean;
  saleId?: string;
  invoiceNumber?: string;
  error?: string;
}

export interface StockAdjustment {
  productId: string;
  previousQuantity: number;
  newQuantity: number;
  reason: string;
}

export interface StockTransfer {
  productId: string;
  fromStationId: string;
  toStationId: string;
  quantity: number;
  notes?: string;
}

export interface StockCount {
  productId: string;
  systemQuantity?: number;
  countedQuantity: number;
  variance: number;
}

export interface POReceipt {
  purchaseOrderId: string;
  items: {
    itemId: string;
    productId: string;
    quantityReceived: number;
  }[];
  notes?: string;
}

// ─── Helper: Get current user ID ──────────────────────────────────────────────

async function getCurrentUserId(): Promise<string | null> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user?.id ?? null;
}

// ─── Cart Calculations ───────────────────────────────────────────────────────

export function calculateCartTotals(items: POSItem[]): POSCart {
  let subtotal = 0;
  let taxAmount = 0;
  let discountAmount = 0;

  for (const item of items) {
    const baseAmount = item.quantity * item.unitPrice;
    const itemDiscount = baseAmount * (item.discountPercent / 100);
    const afterDiscount = baseAmount - itemDiscount;
    const itemTax = afterDiscount * (item.taxRate / 100);

    discountAmount += itemDiscount;
    taxAmount += itemTax;
    subtotal += afterDiscount;
  }

  return {
    items,
    subtotal: Math.round(subtotal * 100) / 100,
    taxAmount: Math.round(taxAmount * 100) / 100,
    discountAmount: Math.round(discountAmount * 100) / 100,
    totalAmount: Math.round((subtotal + taxAmount) * 100) / 100,
  };
}

// ─── Generate Invoice Number ───────────────────────────────────────────────────

async function generateInvoiceNumber(stationId: string): Promise<string> {
  const today = new Date();
  const year = today.getFullYear();
  const month = String(today.getMonth() + 1).padStart(2, "0");
  const day = String(today.getDate()).padStart(2, "0");

  const prefix = `INV-${year}${month}${day}-`;

  const { data, error } = await supabase
    .from("sales_enhanced")
    .select("invoice_number")
    .ilike("invoice_number", `${prefix}%`)
    .order("invoice_number", { ascending: false })
    .limit(1);

  if (error || !data || data.length === 0) {
    return `${prefix}0001`;
  }

  const lastNum = parseInt(
    data[0].invoice_number?.replace(prefix, "") || "0",
    10,
  );
  return `${prefix}${String(lastNum + 1).padStart(4, "0")}`;
}

// ─── Generate PO Number ────────────────────────────────────────────────────────

async function generatePONumber(stationId: string): Promise<string> {
  const today = new Date();
  const year = today.getFullYear();
  const month = String(today.getMonth() + 1).padStart(2, "0");

  const prefix = `PO-${year}${month}-`;

  const { data, error } = await supabase
    .from("purchase_orders")
    .select("order_number")
    .ilike("order_number", `${prefix}%`)
    .order("order_number", { ascending: false })
    .limit(1);

  if (error || !data || data.length === 0) {
    return `${prefix}0001`;
  }

  const lastNum = parseInt(
    data[0].order_number?.replace(prefix, "") || "0",
    10,
  );
  return `${prefix}${String(lastNum + 1).padStart(4, "0")}`;
}

// ─── Generate Transfer Number ─────────────────────────────────────────────────

async function generateTransferNumber(): Promise<string> {
  const today = new Date();
  const year = today.getFullYear();
  const month = String(today.getMonth() + 1).padStart(2, "0");
  const day = String(today.getDate()).padStart(2, "0");

  const prefix = `TRF-${year}${month}${day}-`;

  const { data, error } = await supabase
    .from("stock_transfers")
    .select("transfer_number")
    .ilike("transfer_number", `${prefix}%`)
    .order("transfer_number", { ascending: false })
    .limit(1);

  if (error || !data || data.length === 0) {
    return `${prefix}0001`;
  }

  const lastNum = parseInt(
    data[0].transfer_number?.replace(prefix, "") || "0",
    10,
  );
  return `${prefix}${String(lastNum + 1).padStart(4, "0")}`;
}

// ─── Generate Session Number ─────────────────────────────────────────────────

async function generateSessionNumber(stationId: string): Promise<string> {
  const today = new Date();
  const dateStr = today.toISOString().split("T")[0];

  const prefix = `SES-${dateStr}-`;

  const { data, error } = await supabase
    .from("terminal_sessions")
    .select("session_number")
    .eq("station_id", stationId)
    .ilike("session_number", `${prefix}%`)
    .order("session_number", { ascending: false })
    .limit(1);

  if (error || !data || data.length === 0) {
    return `${prefix}001`;
  }

  const lastNum = parseInt(
    data[0].session_number?.replace(prefix, "") || "0",
    10,
  );
  return `${prefix}${String(lastNum + 1).padStart(3, "0")}`;
}

// ─── Record Inventory Transaction ───────────────────────────────────────────

async function recordInventoryTransaction(
  stationId: string,
  productId: string,
  transactionType: string,
  quantityChange: number,
  previousQuantity: number,
  newQuantity: number,
  referenceId: string | null = null,
  referenceType: string | null = null,
  notes: string | null = null,
  unitCost: number | null = null,
): Promise<{ error: string | null }> {
  const ownerId = await getCurrentUserId();
  if (!ownerId) return { error: "Not authenticated" };

  const { error } = await supabase.from("inventory_transactions").insert({
    station_id: stationId,
    product_id: productId,
    transaction_type: transactionType,
    quantity_change: quantityChange,
    previous_quantity: previousQuantity,
    new_quantity: newQuantity,
    reference_id: referenceId,
    reference_type: referenceType,
    notes,
    unit_cost: unitCost,
    performed_by: ownerId,
    owner_id: ownerId,
  });
  return { error: error?.message ?? null };
}

// ─── Update Product Stock ────────────────────────────────────────────────────

async function updateProductStock(
  productId: string,
  newQuantity: number,
  stationId: string,
  transactionType: string,
  quantityChange: number,
  previousQuantity: number,
  referenceId: string | null = null,
  referenceType: string | null = null,
  notes: string | null = null,
  unitCost: number | null = null,
): Promise<{ error: string | null }> {
  const { error: updateError } = await supabase
    .from("products")
    .update({ stock_quantity: newQuantity })
    .eq("id", productId);

  if (updateError) {
    return { error: updateError.message };
  }

  const { error: txError } = await recordInventoryTransaction(
    stationId,
    productId,
    transactionType,
    quantityChange,
    previousQuantity,
    newQuantity,
    referenceId,
    referenceType,
    notes,
    unitCost,
  );
  return { error: txError };
}

// ─── POS Checkout ─────────────────────────────────────────────────────────────

export async function processPOSCheckout(
  stationId: string,
  cart: POSCart,
  paymentMethod: string,
  paymentReference: string | null = null,
  customerId: string | null = null,
  terminalSessionId: string | null = null,
  notes: string | null = null,
): Promise<SaleResult> {
  const ownerId = await getCurrentUserId();
  if (!ownerId) {
    return { success: false, error: "Not authenticated" };
  }

  if (cart.items.length === 0) {
    return { success: false, error: "Cart is empty" };
  }

  const invoiceNumber = await generateInvoiceNumber(stationId);

  // Start a transaction by creating the sale
  const { data: sale, error: saleError } = await supabase
    .from("sales_enhanced")
    .insert({
      station_id: stationId,
      invoice_number: invoiceNumber,
      customer_id: customerId,
      subtotal: cart.subtotal,
      tax_amount: cart.taxAmount,
      discount_amount: cart.discountAmount,
      total_amount: cart.totalAmount,
      payment_method: paymentMethod,
      payment_reference: paymentReference,
      status: "completed",
      notes,
      cashier_id: ownerId,
      terminal_session_id: terminalSessionId,
      owner_id: ownerId,
    })
    .select()
    .single();

  if (saleError || !sale) {
    return {
      success: false,
      error: saleError?.message || "Failed to create sale",
    };
  }

  // Insert sale items and update stock
  for (const item of cart.items) {
    // Insert sale item
    const { error: itemError } = await supabase.from("sale_items").insert({
      sale_id: sale.id,
      product_id: item.productId,
      product_name: item.name,
      quantity: item.quantity,
      unit_price: item.unitPrice,
      discount_percent: item.discountPercent,
      tax_amount: item.taxAmount,
      total_amount: item.totalAmount,
    });

    if (itemError) {
      // Roll back the orphaned sale header so reports/totals stay consistent.
      await supabase.from("sales_enhanced").delete().eq("id", sale.id);
      return {
        success: false,
        error: `Failed to save sale item "${item.name}": ${itemError.message}`,
      };
    }

    // Update product stock
    const { data: product } = await supabase
      .from("products")
      .select("stock_quantity")
      .eq("id", item.productId)
      .single();

    const previousQty = product?.stock_quantity || 0;
    const newQty = Math.max(0, previousQty - item.quantity);

    const { error: stockError } = await updateProductStock(
      item.productId,
      newQty,
      stationId,
      "sale",
      -item.quantity,
      previousQty,
      sale.id,
      "sale",
      `Sale ${invoiceNumber}`,
      item.unitPrice,
    );

    if (stockError) {
      // Stock update failed — the sale is recorded but stock is stale.
      // Roll back the sale to keep stock and sales in sync.
      await supabase.from("sales_enhanced").delete().eq("id", sale.id);
      return {
        success: false,
        error: `Failed to update stock for "${item.name}": ${stockError}`,
      };
    }
  }

  // Update terminal session if applicable
  if (terminalSessionId) {
    const sessionUpdate: Record<string, number> = {};
    if (paymentMethod === "cash") {
      sessionUpdate.cash_sales = cart.totalAmount;
    } else if (paymentMethod === "mpesa") {
      sessionUpdate.mpesa_sales = cart.totalAmount;
    } else if (paymentMethod === "card") {
      sessionUpdate.card_sales = cart.totalAmount;
    }
    sessionUpdate.total_sales = cart.totalAmount;

    const { data: session } = await supabase
      .from("terminal_sessions")
      .select("total_sales, cash_sales, mpesa_sales, card_sales")
      .eq("id", terminalSessionId)
      .single();

    if (session) {
      await supabase
        .from("terminal_sessions")
        .update({
          total_sales: (session.total_sales || 0) + cart.totalAmount,
          cash_sales:
            (session.cash_sales || 0) +
            (paymentMethod === "cash" ? cart.totalAmount : 0),
          mpesa_sales:
            (session.mpesa_sales || 0) +
            (paymentMethod === "mpesa" ? cart.totalAmount : 0),
          card_sales:
            (session.card_sales || 0) +
            (paymentMethod === "card" ? cart.totalAmount : 0),
        })
        .eq("id", terminalSessionId);
    }
  }

  return {
    success: true,
    saleId: sale.id,
    invoiceNumber,
  };
}

// ─── Stock Adjustment ─────────────────────────────────────────────────────────

export async function adjustStock(
  stationId: string,
  adjustments: StockAdjustment[],
  notes: string | null = null,
): Promise<{ success: boolean; error?: string }> {
  const ownerId = await getCurrentUserId();
  if (!ownerId) {
    return { success: false, error: "Not authenticated" };
  }

  for (const adj of adjustments) {
    const { data: product } = await supabase
      .from("products")
      .select("stock_quantity, cost_price")
      .eq("id", adj.productId)
      .single();

    if (!product) continue;

    const previousQty = product.stock_quantity || 0;
    const newQty = Math.max(0, adj.newQuantity);

    const { error: stockError } = await updateProductStock(
      adj.productId,
      newQty,
      stationId,
      "adjustment",
      newQty - previousQty,
      previousQty,
      null,
      null,
      notes || adj.reason,
      product.cost_price,
    );

    if (stockError) {
      return {
        success: false,
        error: `Failed to adjust stock for product: ${stockError}`,
      };
    }
  }

  return { success: true };
}

// ─── Stock Transfer ─────────────────────────────────────────────────────────

export async function createStockTransfer(transfer: StockTransfer): Promise<{
  success: boolean;
  transferId?: string;
  transferNumber?: string;
  error?: string;
}> {
  const ownerId = await getCurrentUserId();
  if (!ownerId) {
    return { success: false, error: "Not authenticated" };
  }

  const transferNumber = await generateTransferNumber();

  const { data: stockTransfer, error } = await supabase
    .from("stock_transfers")
    .insert({
      from_station_id: transfer.fromStationId,
      to_station_id: transfer.toStationId,
      transfer_number: transferNumber,
      product_id: transfer.productId,
      quantity: transfer.quantity,
      notes: transfer.notes,
      status: "pending",
      created_by: ownerId,
      owner_id: ownerId,
    })
    .select()
    .single();

  if (error || !stockTransfer) {
    return {
      success: false,
      error: error?.message || "Failed to create transfer",
    };
  }

  return {
    success: true,
    transferId: stockTransfer.id,
    transferNumber,
  };
}

export async function completeStockTransfer(
  transferId: string,
): Promise<{ success: boolean; error?: string }> {
  const ownerId = await getCurrentUserId();
  if (!ownerId) {
    return { success: false, error: "Not authenticated" };
  }

  const { data: transfer, error: fetchError } = await supabase
    .from("stock_transfers")
    .select("*")
    .eq("id", transferId)
    .single();

  if (fetchError || !transfer) {
    return { success: false, error: "Transfer not found" };
  }

  // Update source station stock
  const { data: fromProduct } = await supabase
    .from("products")
    .select("stock_quantity, cost_price")
    .eq("id", transfer.product_id)
    .eq("station_id", transfer.from_station_id)
    .single();

  if (fromProduct) {
    const newFromQty = Math.max(
      0,
      (fromProduct.stock_quantity || 0) - transfer.quantity,
    );
    const { error: outErr } = await updateProductStock(
      transfer.product_id,
      newFromQty,
      transfer.from_station_id,
      "transfer_out",
      -transfer.quantity,
      fromProduct.stock_quantity || 0,
      transferId,
      "transfer",
      `Transfer ${transfer.transfer_number}`,
      fromProduct.cost_price,
    );
    if (outErr) {
      return {
        success: false,
        error: `Failed to deduct source stock: ${outErr}`,
      };
    }
  }

  // Update destination station stock (or create product there)
  const { data: toProduct } = await supabase
    .from("products")
    .select("stock_quantity, cost_price")
    .eq("id", transfer.product_id)
    .eq("station_id", transfer.to_station_id)
    .single();

  if (toProduct) {
    const newToQty = (toProduct.stock_quantity || 0) + transfer.quantity;
    const { error: inErr } = await updateProductStock(
      transfer.product_id,
      newToQty,
      transfer.to_station_id,
      "transfer_in",
      transfer.quantity,
      toProduct.stock_quantity || 0,
      transferId,
      "transfer",
      `Transfer ${transfer.transfer_number}`,
      fromProduct?.cost_price,
    );
    if (inErr) {
      return {
        success: false,
        error: `Failed to add destination stock: ${inErr}`,
      };
    }
  }

  // Update transfer status
  const { error: statusError } = await supabase
    .from("stock_transfers")
    .update({ status: "completed" })
    .eq("id", transferId);

  if (statusError) {
    return {
      success: false,
      error: `Stock moved but failed to mark transfer complete: ${statusError.message}`,
    };
  }

  return { success: true };
}

// ─── Stock Count ─────────────────────────────────────────────────────────────

export async function processStockCount(
  stationId: string,
  counts: StockCount[],
  notes: string | null = null,
): Promise<{ success: boolean; error?: string }> {
  const ownerId = await getCurrentUserId();
  if (!ownerId) {
    return { success: false, error: "Not authenticated" };
  }

  for (const count of counts) {
    if (count.variance === 0) continue;

    const { data: product } = await supabase
      .from("products")
      .select("stock_quantity, cost_price")
      .eq("id", count.productId)
      .single();

    if (!product) continue;

    const newQty = count.countedQuantity;
    const variance = count.variance;

    const { error: countError } = await updateProductStock(
      count.productId,
      newQty,
      stationId,
      "count",
      variance,
      product.stock_quantity || 0,
      null,
      null,
      notes || "Stock count adjustment",
      product.cost_price,
    );

    if (countError) {
      return {
        success: false,
        error: `Failed to apply stock count: ${countError}`,
      };
    }
  }

  return { success: true };
}

// ─── Record Wastage ──────────────────────────────────────────────────────────

export async function recordWastage(
  stationId: string,
  productId: string,
  quantity: number,
  notes: string | null = null,
): Promise<{ success: boolean; error?: string }> {
  const ownerId = await getCurrentUserId();
  if (!ownerId) {
    return { success: false, error: "Not authenticated" };
  }

  const { data: product } = await supabase
    .from("products")
    .select("stock_quantity, cost_price")
    .eq("id", productId)
    .single();

  if (!product) {
    return { success: false, error: "Product not found" };
  }

  const previousQty = product.stock_quantity || 0;
  const newQty = Math.max(0, previousQty - quantity);

  const { error: stockError } = await updateProductStock(
    productId,
    newQty,
    stationId,
    "wastage",
    -quantity,
    previousQty,
    null,
    null,
    notes,
    product.cost_price,
  );

  if (stockError) {
    return { success: false, error: `Failed to record wastage: ${stockError}` };
  }

  return { success: true };
}

// ─── Purchase Order ──────────────────────────────────────────────────────────

export async function createPurchaseOrder(
  stationId: string,
  supplierId: string,
  items: {
    productId: string;
    productName: string;
    quantity: number;
    unitCost: number;
    taxRate: number;
  }[],
  expectedDate: string | null = null,
  notes: string | null = null,
): Promise<{
  success: boolean;
  poId?: string;
  orderNumber?: string;
  error?: string;
}> {
  const ownerId = await getCurrentUserId();
  if (!ownerId) {
    return { success: false, error: "Not authenticated" };
  }

  const orderNumber = await generatePONumber(stationId);

  // Calculate totals
  let subtotal = 0;
  let taxAmount = 0;

  const orderItems = items.map((item) => {
    const itemTotal = item.quantity * item.unitCost;
    const itemTax = itemTotal * (item.taxRate / 100);
    subtotal += itemTotal;
    taxAmount += itemTax;

    return {
      product_id: item.productId,
      product_name: item.productName,
      quantity: item.quantity,
      unit_cost: item.unitCost,
      tax_rate: item.taxRate,
      tax_amount: Math.round(itemTax * 100) / 100,
      total_amount: Math.round((itemTotal + itemTax) * 100) / 100,
    };
  });

  const totalAmount = Math.round((subtotal + taxAmount) * 100) / 100;

  // Create PO
  const { data: po, error } = await supabase
    .from("purchase_orders")
    .insert({
      station_id: stationId,
      supplier_id: supplierId,
      order_number: orderNumber,
      expected_date: expectedDate,
      subtotal,
      tax_amount: taxAmount,
      total_amount: totalAmount,
      status: "draft",
      notes,
      created_by: ownerId,
      owner_id: ownerId,
    })
    .select()
    .single();

  if (error || !po) {
    return {
      success: false,
      error: error?.message || "Failed to create purchase order",
    };
  }

  // Insert PO items
  for (const item of orderItems) {
    const { error: itemError } = await supabase
      .from("purchase_order_items")
      .insert({
        purchase_order_id: po.id,
        ...item,
      });

    if (itemError) {
      // Roll back the orphaned PO header (cascade deletes any partial items).
      await supabase.from("purchase_orders").delete().eq("id", po.id);
      return {
        success: false,
        error: `Failed to save purchase order item "${item.product_name}": ${itemError.message}`,
      };
    }
  }

  return {
    success: true,
    poId: po.id,
    orderNumber,
  };
}

export async function receivePurchaseOrder(
  receipt: POReceipt,
): Promise<{ success: boolean; error?: string }> {
  const ownerId = await getCurrentUserId();
  if (!ownerId) {
    return { success: false, error: "Not authenticated" };
  }

  const { data: po, error: poError } = await supabase
    .from("purchase_orders")
    .select("*, purchase_order_items(*)")
    .eq("id", receipt.purchaseOrderId)
    .single();

  if (poError || !po) {
    return { success: false, error: "Purchase order not found" };
  }

  for (const receivedItem of receipt.items) {
    const poItem = po.purchase_order_items?.find(
      (i: any) => i.id === receivedItem.itemId,
    );
    if (!poItem) continue;

    const newReceivedQty =
      (poItem.quantity_received || 0) + receivedItem.quantityReceived;
    const isFullyReceived = newReceivedQty >= poItem.quantity;

    // Update PO item
    await supabase
      .from("purchase_order_items")
      .update({
        quantity_received: newReceivedQty,
        is_received: isFullyReceived,
      })
      .eq("id", receivedItem.itemId);

    // Update stock if product exists
    const { data: product } = await supabase
      .from("products")
      .select("stock_quantity, cost_price")
      .eq("id", receivedItem.productId)
      .single();

    if (product) {
      const previousQty = product.stock_quantity || 0;
      const newQty = previousQty + receivedItem.quantityReceived;

      await updateProductStock(
        receivedItem.productId,
        newQty,
        po.station_id,
        "purchase",
        receivedItem.quantityReceived,
        previousQty,
        receipt.purchaseOrderId,
        "purchase_order",
        `PO Receipt ${po.order_number}`,
        poItem.unit_cost,
      );
    }
  }

  // Check if all items are received
  const { data: updatedItems } = await supabase
    .from("purchase_order_items")
    .select("is_received")
    .eq("purchase_order_id", receipt.purchaseOrderId);

  const allReceived = updatedItems?.every((i: any) => i.is_received) ?? false;

  if (allReceived) {
    await supabase
      .from("purchase_orders")
      .update({ status: "received" })
      .eq("id", receipt.purchaseOrderId);
  }

  return { success: true };
}

// ─── Terminal Sessions ───────────────────────────────────────────────────────

export async function openTerminalSession(
  stationId: string,
  openingCash: number = 0,
): Promise<{
  success: boolean;
  sessionId?: string;
  sessionNumber?: string;
  error?: string;
}> {
  const ownerId = await getCurrentUserId();
  if (!ownerId) {
    return { success: false, error: "Not authenticated" };
  }

  // Check if there's already an open session
  const { data: openSession } = await supabase
    .from("terminal_sessions")
    .select("id")
    .eq("station_id", stationId)
    .eq("status", "open")
    .single();

  if (openSession) {
    return { success: false, error: "There is already an open session" };
  }

  const sessionNumber = await generateSessionNumber(stationId);

  const { data: session, error } = await supabase
    .from("terminal_sessions")
    .insert({
      station_id: stationId,
      session_number: sessionNumber,
      opening_cash: openingCash,
      expected_cash: openingCash,
      status: "open",
      opened_by: ownerId,
      owner_id: ownerId,
    })
    .select()
    .single();

  if (error || !session) {
    return {
      success: false,
      error: error?.message || "Failed to open session",
    };
  }

  return {
    success: true,
    sessionId: session.id,
    sessionNumber,
  };
}

export async function closeTerminalSession(
  sessionId: string,
  countedCash: number,
  notes: string | null = null,
): Promise<{ success: boolean; variance?: number; error?: string }> {
  const ownerId = await getCurrentUserId();
  if (!ownerId) {
    return { success: false, error: "Not authenticated" };
  }

  const { data: session, error: fetchError } = await supabase
    .from("terminal_sessions")
    .select("*")
    .eq("id", sessionId)
    .single();

  if (fetchError || !session) {
    return { success: false, error: "Session not found" };
  }

  const variance =
    Math.round((countedCash - session.expected_cash) * 100) / 100;

  await supabase
    .from("terminal_sessions")
    .update({
      closing_time: new Date().toISOString(),
      counted_cash: countedCash,
      variance,
      status: "closed",
      notes,
      closed_by: ownerId,
    })
    .eq("id", sessionId);

  return { success: true, variance };
}

// ─── Fetch Data ──────────────────────────────────────────────────────────────

export async function fetchProducts(stationId: string): Promise<any[]> {
  const { data, error } = await supabase
    .from("products")
    .select("*")
    .eq("station_id", stationId)
    .eq("is_active", true)
    .order("name");
  if (error) {
    console.error("fetchProducts error:", error.message);
  }
  return data || [];
}

/**
 * Fetch ALL products for a station INCLUDING inactive ones. Used by the
 * Stock Management Products sub-tab so inactive products can be viewed,
 * re-activated, edited, and deleted (fetchProducts filters is_active=true,
 * which made inactive products permanently unmanageable/ghost rows).
 */
export async function fetchAllProducts(stationId: string): Promise<any[]> {
  const { data, error } = await supabase
    .from("products")
    .select("*")
    .eq("station_id", stationId)
    .order("name");
  if (error) {
    console.error("fetchAllProducts error:", error.message);
  }
  return data || [];
}

export async function fetchCustomers(stationId: string): Promise<any[]> {
  const { data, error } = await supabase
    .from("customers")
    .select("*")
    .eq("station_id", stationId)
    .or("is_active.is.null,is_active.eq.true")
    .order("name");
  if (error) {
    console.error("[fetchCustomers] query failed:", error);
    throw error;
  }
  return data || [];
}

export async function fetchSuppliers(stationId: string): Promise<any[]> {
  const { data, error } = await supabase
    .from("suppliers")
    .select("*")
    .eq("station_id", stationId)
    .or("is_active.is.null,is_active.eq.true")
    .order("name");
  if (error) {
    console.error("[fetchSuppliers] query failed:", error);
    throw error;
  }
  return data || [];
}

export async function fetchSales(
  stationId: string,
  startDate?: string,
  endDate?: string,
): Promise<any[]> {
  let query = supabase
    .from("sales_enhanced")
    .select("*, sale_items(*), customers(*)")
    .eq("station_id", stationId)
    .order("created_at", { ascending: false });

  if (startDate) {
    // startDate is a bare date (YYYY-MM-DD); gte against midnight is correct.
    query = query.gte("created_at", startDate);
  }
  if (endDate) {
    // endDate is a bare date (YYYY-MM-DD). A timestamp like
    // "2026-08-12T15:30:00" sorts AFTER "2026-08-12" lexicographically, so a
    // plain `lte` would EXCLUDE every sale later than midnight on the end
    // date. Append T23:59:59 so the entire end day is included.
    query = query.lte("created_at", `${endDate}T23:59:59`);
  }

  const { data, error } = await query;
  if (error) {
    // Surface the error instead of silently returning [] (which the UI
    // rendered as "No sales found" — indistinguishable from a real empty
    // result and hid RLS/table-missing/network failures).
    throw error;
  }
  return data || [];
}

export async function fetchExpenses(
  stationId: string,
  category?: string,
  startDate?: string,
  endDate?: string,
): Promise<any[]> {
  let query = supabase
    .from("expenses")
    .select("*")
    .eq("station_id", stationId)
    .order("expense_date", { ascending: false });

  if (category) {
    query = query.eq("category", category);
  }
  if (startDate) {
    query = query.gte("expense_date", startDate);
  }
  if (endDate) {
    query = query.lte("expense_date", endDate);
  }

  const { data, error } = await query;
  if (error) {
    console.error("[fetchExpenses] query failed:", error);
    throw error;
  }
  return data || [];
}

export async function fetchExpenseCategories(
  stationId: string,
): Promise<any[]> {
  const { data, error } = await supabase
    .from("expense_categories")
    .select("*")
    .eq("station_id", stationId)
    .order("name");
  if (error) {
    console.error("[fetchExpenseCategories] query failed:", error);
    throw error;
  }
  return data || [];
}

export async function fetchInventoryTransactions(
  stationId: string,
  productId?: string,
  limit: number = 100,
): Promise<any[]> {
  let query = supabase
    .from("inventory_transactions")
    .select("*, products(*)")
    .eq("station_id", stationId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (productId) {
    query = query.eq("product_id", productId);
  }

  const { data, error } = await query;
  if (error) {
    console.error("fetchInventoryTransactions error:", error.message);
  }
  return data || [];
}

export async function fetchOpenSessions(stationId: string): Promise<any[]> {
  const { data, error } = await supabase
    .from("terminal_sessions")
    .select("*")
    .eq("station_id", stationId)
    .eq("status", "open")
    .order("created_at", { ascending: false });
  if (error) {
    console.error("[fetchOpenSessions] query failed:", error);
    throw error;
  }
  return data || [];
}

export async function fetchPurchaseOrders(
  stationId: string,
  status?: string,
): Promise<any[]> {
  let query = supabase
    .from("purchase_orders")
    .select("*, purchase_order_items(*), suppliers(*)")
    .eq("station_id", stationId)
    .order("created_at", { ascending: false });

  if (status) {
    query = query.eq("status", status);
  }

  const { data, error } = await query;
  if (error) {
    console.error("[fetchPurchaseOrders] query failed:", error);
    throw error;
  }
  return data || [];
}

export async function fetchSalesReport(
  stationId: string,
  startDate: string,
  endDate: string,
): Promise<{
  sales: any[];
  totalRevenue: number;
  totalTax: number;
  paymentBreakdown: Record<string, number>;
}> {
  const { data: sales } = await supabase
    .from("sales_enhanced")
    .select("*")
    .eq("station_id", stationId)
    .gte("created_at", startDate)
    .lte("created_at", endDate);

  const salesData = sales || [];
  const totalRevenue = salesData.reduce(
    (sum, s) => sum + (s.total_amount || 0),
    0,
  );
  const totalTax = salesData.reduce((sum, s) => sum + (s.tax_amount || 0), 0);

  const paymentBreakdown: Record<string, number> = {};
  for (const sale of salesData) {
    const method = sale.payment_method || "cash";
    paymentBreakdown[method] =
      (paymentBreakdown[method] || 0) + sale.total_amount;
  }

  return { sales: salesData, totalRevenue, totalTax, paymentBreakdown };
}

export async function fetchExpensesReport(
  stationId: string,
  startDate: string,
  endDate: string,
): Promise<{
  expenses: any[];
  totalExpenses: number;
  categoryBreakdown: Record<string, number>;
}> {
  const { data: expenses } = await supabase
    .from("expenses")
    .select("*")
    .eq("station_id", stationId)
    .gte("expense_date", startDate)
    .lte("expense_date", endDate);

  const expensesData = expenses || [];
  const totalExpenses = expensesData.reduce(
    (sum, e) => sum + (e.amount || 0),
    0,
  );

  const categoryBreakdown: Record<string, number> = {};
  for (const expense of expensesData) {
    const cat = expense.category || "Other";
    categoryBreakdown[cat] = (categoryBreakdown[cat] || 0) + expense.amount;
  }

  return { expenses: expensesData, totalExpenses, categoryBreakdown };
}

export async function fetchInventoryValuation(
  stationId: string,
): Promise<{ products: any[]; totalValue: number; totalQuantity: number }> {
  const { data: products } = await supabase
    .from("products")
    .select("*")
    .eq("station_id", stationId)
    .eq("is_active", true);

  const productsData = products || [];
  const totalValue = productsData.reduce((sum, p) => {
    const qty = p.stock_quantity || 0;
    const cost = p.cost_price || 0;
    return sum + qty * cost;
  }, 0);

  const totalQuantity = productsData.reduce(
    (sum, p) => sum + (p.stock_quantity || 0),
    0,
  );

  return { products: productsData, totalValue, totalQuantity };
}
