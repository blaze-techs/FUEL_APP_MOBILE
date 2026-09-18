import { supabase } from "@/supabase/client";

export type FuelLedgerReading = {
  id: string;
  station_id: string;
  shift_id: string;
  pump_id?: string | null;
  fuel_type_id?: string | null;
  nozzle_code?: string | null;
  opening_meter: number;
  closing_meter: number;
  price_per_liter: number;
  actual_sales?: number | null;
};

export type Reconciliation = {
  litresSold: number;
  expectedSales: number;
  actualSales: number | null;
  varianceAmount: number | null;
  varianceLitres: number | null;
  status: "pending" | "balanced" | "variance";
};

const round = (n: number, dp = 2) => {
  const p = 10 ** dp;
  return Math.round((n + Number.EPSILON) * p) / p;
};

export function calculateFuelReconciliation(
  openingMeter: number,
  closingMeter: number,
  pricePerLiter: number,
  actualSales: number | null = null,
): Reconciliation {
  if (![openingMeter, closingMeter, pricePerLiter].every(Number.isFinite)) {
    throw new Error("Meter readings and price must be finite numbers");
  }
  if (openingMeter < 0 || closingMeter < openingMeter || pricePerLiter < 0) {
    throw new Error("Invalid meter sequence or fuel price");
  }

  const litresSold = round(closingMeter - openingMeter, 3);
  const expectedSales = round(litresSold * pricePerLiter, 2);
  if (actualSales == null) {
    return {
      litresSold,
      expectedSales,
      actualSales: null,
      varianceAmount: null,
      varianceLitres: null,
      status: "pending",
    };
  }
  if (!Number.isFinite(actualSales) || actualSales < 0) {
    throw new Error("Actual sales must be a non-negative finite number");
  }

  const varianceAmount = round(actualSales - expectedSales, 2);
  const varianceLitres =
    pricePerLiter > 0
      ? round(actualSales / pricePerLiter - litresSold, 3)
      : null;
  return {
    litresSold,
    expectedSales,
    actualSales: round(actualSales, 2),
    varianceAmount,
    varianceLitres,
    status: Math.abs(varianceAmount) < 0.01 ? "balanced" : "variance",
  };
}

export async function createMeterReading(
  input: Omit<FuelLedgerReading, "id"> & { idempotencyKey?: string },
) {
  const calc = calculateFuelReconciliation(
    input.opening_meter,
    input.closing_meter,
    input.price_per_liter,
    input.actual_sales ?? null,
  );
  const { data, error } = await supabase
    .from("shift_pump_readings")
    .insert({
      station_id: input.station_id,
      shift_id: input.shift_id,
      pump_id: input.pump_id ?? null,
      fuel_type_id: input.fuel_type_id ?? null,
      nozzle_code: input.nozzle_code ?? null,
      opening_meter: input.opening_meter,
      closing_meter: input.closing_meter,
      price_per_liter: input.price_per_liter,
      actual_sales: input.actual_sales ?? null,
      variance_amount: calc.varianceAmount,
      variance_litres: calc.varianceLitres,
      variance_reason: null,
    })
    .select("id")
    .single();

  if (error) throw new Error(error.message);
  return { id: data.id as string, reconciliation: calc };
}

export async function reconcileMeterReading(
  readingId: string,
  actualSales: number,
  reason?: string,
) {
  const { data, error } = await supabase.rpc("fuelpro_reconcile_reading", {
    p_reading_id: readingId,
    p_actual_sales: actualSales,
    p_reason: reason ?? null,
  });
  if (error) throw new Error(error.message);
  return data as {
    reading_id: string;
    litres_sold: number;
    expected_sales: number;
    actual_sales: number;
    variance_amount: number;
    variance_litres: number | null;
    variance_reason: string | null;
  };
}

export async function recordPayment(input: {
  stationId: string;
  saleId?: string;
  provider: string;
  providerReference: string;
  paymentMethod: string;
  amount: number;
  currency?: string;
  customerPhone?: string;
  metadata?: Record<string, unknown>;
}) {
  if (!Number.isFinite(input.amount) || input.amount <= 0)
    throw new Error("Payment amount must be greater than zero");

  const { data, error } = await supabase
    .from("payment_transactions")
    .upsert(
      {
        station_id: input.stationId,
        sale_id: input.saleId ?? null,
        provider: input.provider,
        provider_reference: input.providerReference,
        payment_method: input.paymentMethod,
        amount: round(input.amount, 2),
        currency: input.currency ?? "KES",
        customer_phone: input.customerPhone ?? null,
        metadata: input.metadata ?? {},
      },
      { onConflict: "provider,provider_reference", ignoreDuplicates: false },
    )
    .select("*")
    .single();

  if (error) throw new Error(error.message);
  return data;
}

export async function enqueueOfflineOperation(input: {
  stationId?: string;
  deviceId: string;
  idempotencyKey: string;
  entityType: string;
  entityId?: string;
  operation: "create" | "update" | "delete" | "reversal";
  payload: Record<string, unknown>;
}) {
  const { data, error } = await supabase
    .from("sync_outbox")
    .upsert(
      {
        station_id: input.stationId ?? null,
        device_id: input.deviceId,
        idempotency_key: input.idempotencyKey,
        entity_type: input.entityType,
        entity_id: input.entityId ?? null,
        operation: input.operation,
        payload: input.payload,
        status: "pending",
        next_attempt_at: new Date().toISOString(),
      },
      { onConflict: "idempotency_key" },
    )
    .select("*")
    .single();

  if (error) throw new Error(error.message);
  return data;
}

export async function isAccountingPeriodLocked(
  stationId: string,
  date = new Date(),
) {
  const { data, error } = await supabase
    .from("accounting_period_locks")
    .select("id")
    .eq("station_id", stationId)
    .lte("period_start", date.toISOString().slice(0, 10))
    .gte("period_end", date.toISOString().slice(0, 10))
    .limit(1);

  if (error) throw new Error(error.message);
  return (data?.length ?? 0) > 0;
}
