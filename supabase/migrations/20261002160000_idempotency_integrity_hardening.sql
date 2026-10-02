BEGIN;

-- Idempotency must be replay-safe but must never allow a reused key to silently
-- represent a different business payload. This migration hardens sale,
-- reversal and tank-movement posting functions accordingly.

CREATE OR REPLACE FUNCTION public.fuelpro_post_sale(
  p_station uuid, p_shift uuid, p_nozzle uuid, p_litres numeric,
  p_unit_price numeric, p_tax numeric, p_payment_status text,
  p_customer uuid, p_vehicle text, p_receipt text, p_external_ref text,
  p_idempotency_key text, p_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS sales_ledger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_sale sales_ledger; v_gross numeric; v_net numeric;
BEGIN
  IF NOT fuelpro_has_permission(p_station,'sale.create') THEN RAISE EXCEPTION 'Not authorized'; END IF;
  IF fuelpro_period_is_locked(p_station,now()) THEN RAISE EXCEPTION 'Accounting period is locked'; END IF;
  IF p_litres < 0 OR p_unit_price < 0 OR p_tax < 0 THEN RAISE EXCEPTION 'Invalid sale values'; END IF;
  v_gross := round(p_litres*p_unit_price,2);
  v_net := round(v_gross-p_tax,2);
  IF v_net < 0 THEN RAISE EXCEPTION 'Tax cannot exceed gross amount'; END IF;

  IF p_idempotency_key IS NOT NULL THEN
    SELECT * INTO v_sale FROM sales_ledger WHERE idempotency_key=p_idempotency_key FOR UPDATE;
    IF FOUND THEN
      IF v_sale.station_id IS DISTINCT FROM p_station
         OR v_sale.shift_id IS DISTINCT FROM p_shift
         OR v_sale.nozzle_id IS DISTINCT FROM p_nozzle
         OR v_sale.quantity_litres IS DISTINCT FROM p_litres
         OR v_sale.unit_price IS DISTINCT FROM p_unit_price
         OR v_sale.tax_amount IS DISTINCT FROM p_tax
         OR v_sale.payment_status IS DISTINCT FROM coalesce(p_payment_status,'unpaid')
         OR v_sale.customer_id IS DISTINCT FROM p_customer
         OR v_sale.fleet_vehicle_ref IS DISTINCT FROM p_vehicle
         OR v_sale.receipt_number IS DISTINCT FROM p_receipt
         OR v_sale.external_reference IS DISTINCT FROM p_external_ref
         OR coalesce(v_sale.metadata,'{}'::jsonb) IS DISTINCT FROM coalesce(p_metadata,'{}'::jsonb)
      THEN
        RAISE EXCEPTION 'Idempotency key already belongs to a different sale payload';
      END IF;
      RETURN v_sale;
    END IF;
  END IF;

  INSERT INTO sales_ledger(
    station_id,shift_id,nozzle_id,entry_type,quantity_litres,unit_price,
    gross_amount,tax_amount,net_amount,payment_status,customer_id,fleet_vehicle_ref,
    receipt_number,external_reference,idempotency_key,created_by,metadata
  ) VALUES(
    p_station,p_shift,p_nozzle,'sale',p_litres,p_unit_price,v_gross,p_tax,v_net,
    coalesce(p_payment_status,'unpaid'),p_customer,p_vehicle,p_receipt,p_external_ref,
    p_idempotency_key,auth.uid(),coalesce(p_metadata,'{}'::jsonb)
  ) RETURNING * INTO v_sale;

  INSERT INTO immutable_audit_log(station_id,user_id,action,entity_type,entity_id,new_values)
  VALUES(p_station,auth.uid(),'sale.post','sales_ledger',v_sale.id::text,to_jsonb(v_sale));
  RETURN v_sale;
EXCEPTION WHEN unique_violation THEN
  IF p_idempotency_key IS NOT NULL THEN
    SELECT * INTO v_sale FROM sales_ledger WHERE idempotency_key=p_idempotency_key;
    IF FOUND THEN
      IF v_sale.station_id IS DISTINCT FROM p_station OR v_sale.shift_id IS DISTINCT FROM p_shift
         OR v_sale.nozzle_id IS DISTINCT FROM p_nozzle OR v_sale.quantity_litres IS DISTINCT FROM p_litres
         OR v_sale.unit_price IS DISTINCT FROM p_unit_price OR v_sale.tax_amount IS DISTINCT FROM p_tax
      THEN RAISE EXCEPTION 'Idempotency key already belongs to a different sale payload'; END IF;
      RETURN v_sale;
    END IF;
  END IF;
  RAISE;
END;
$$;

CREATE OR REPLACE FUNCTION public.fuelpro_reverse_sale(
  p_sale uuid, p_reason text, p_idempotency_key text
)
RETURNS sales_ledger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_original sales_ledger; v_rev sales_ledger;
BEGIN
  SELECT * INTO v_original FROM sales_ledger WHERE id=p_sale AND entry_type='sale' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Sale not found'; END IF;
  IF NOT fuelpro_has_permission(v_original.station_id,'sale.reverse') THEN RAISE EXCEPTION 'Not authorized'; END IF;
  IF fuelpro_period_is_locked(v_original.station_id,v_original.created_at) THEN RAISE EXCEPTION 'Accounting period is locked'; END IF;

  IF p_idempotency_key IS NOT NULL THEN
    SELECT * INTO v_rev FROM sales_ledger WHERE idempotency_key=p_idempotency_key AND entry_type='reversal' FOR UPDATE;
    IF FOUND THEN
      IF v_rev.reversal_of IS DISTINCT FROM p_sale THEN RAISE EXCEPTION 'Idempotency key already belongs to a different reversal'; END IF;
      RETURN v_rev;
    END IF;
  END IF;
  IF EXISTS(SELECT 1 FROM sales_ledger WHERE reversal_of=p_sale) THEN RAISE EXCEPTION 'Sale already reversed'; END IF;

  INSERT INTO sales_ledger(
    station_id,shift_id,nozzle_id,entry_type,reversal_of,quantity_litres,unit_price,
    gross_amount,tax_amount,net_amount,payment_status,customer_id,fleet_vehicle_ref,
    receipt_number,external_reference,idempotency_key,created_by,metadata
  ) VALUES(
    v_original.station_id,v_original.shift_id,v_original.nozzle_id,'reversal',v_original.id,
    v_original.quantity_litres,v_original.unit_price,-v_original.gross_amount,
    -v_original.tax_amount,-v_original.net_amount,'reversed',v_original.customer_id,
    v_original.fleet_vehicle_ref,NULL,v_original.external_reference,p_idempotency_key,
    auth.uid(),jsonb_build_object('reason',p_reason)
  ) RETURNING * INTO v_rev;

  INSERT INTO immutable_audit_log(station_id,user_id,action,entity_type,entity_id,new_values)
  VALUES(v_original.station_id,auth.uid(),'sale.reverse','sales_ledger',v_rev.id::text,to_jsonb(v_rev));
  RETURN v_rev;
EXCEPTION WHEN unique_violation THEN
  IF p_idempotency_key IS NOT NULL THEN
    SELECT * INTO v_rev FROM sales_ledger WHERE idempotency_key=p_idempotency_key AND entry_type='reversal';
    IF FOUND THEN
      IF v_rev.reversal_of IS DISTINCT FROM p_sale THEN RAISE EXCEPTION 'Idempotency key already belongs to a different reversal'; END IF;
      RETURN v_rev;
    END IF;
  END IF;
  RAISE;
END;
$$;

CREATE OR REPLACE FUNCTION public.fuelpro_post_tank_movement(
  p_station uuid, p_tank uuid, p_fuel uuid, p_type text, p_quantity numeric,
  p_counterparty uuid DEFAULT NULL, p_unit_cost numeric DEFAULT NULL,
  p_reference_type text DEFAULT NULL, p_reference_id uuid DEFAULT NULL,
  p_notes text DEFAULT NULL, p_idempotency_key text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_primary tank_movements; v_counter tank_movements;
DECLARE v_out_key text; v_in_key text; v_expected_qty numeric;
BEGIN
  IF NOT fuelpro_has_permission(p_station,'inventory.write') THEN RAISE EXCEPTION 'Not authorized'; END IF;
  IF p_quantity<=0 THEN RAISE EXCEPTION 'Quantity must be positive'; END IF;
  IF p_type NOT IN ('delivery','sale','adjustment','wastage','transfer','opening','closing') THEN RAISE EXCEPTION 'Unsupported tank movement type'; END IF;

  IF p_type='transfer' THEN
    IF p_counterparty IS NULL THEN RAISE EXCEPTION 'Counterparty tank required for transfer'; END IF;
    v_out_key := CASE WHEN p_idempotency_key IS NULL THEN NULL ELSE p_idempotency_key||':out' END;
    v_in_key := CASE WHEN p_idempotency_key IS NULL THEN NULL ELSE p_idempotency_key||':in' END;
    IF p_idempotency_key IS NOT NULL THEN
      SELECT * INTO v_primary FROM tank_movements WHERE idempotency_key=v_out_key FOR UPDATE;
      IF FOUND THEN
        SELECT * INTO v_counter FROM tank_movements WHERE idempotency_key=v_in_key;
        IF NOT FOUND OR v_primary.station_id IS DISTINCT FROM p_station
           OR v_primary.tank_id IS DISTINCT FROM p_tank
           OR v_primary.counterparty_tank_id IS DISTINCT FROM p_counterparty
           OR v_primary.fuel_type_id IS DISTINCT FROM p_fuel
           OR v_primary.quantity_litres IS DISTINCT FROM -p_quantity
        THEN RAISE EXCEPTION 'Idempotency key already belongs to a different tank transfer'; END IF;
        RETURN jsonb_build_object('movement',to_jsonb(v_primary),'counter_movement',to_jsonb(v_counter),'duplicate',true);
      END IF;
    END IF;
    INSERT INTO tank_movements(station_id,fuel_type_id,tank_id,counterparty_tank_id,movement_type,quantity_litres,reference_type,reference_id,unit_cost,notes,created_by,idempotency_key)
    VALUES(p_station,p_fuel,p_tank,p_counterparty,'transfer_out',-p_quantity,p_reference_type,p_reference_id,p_unit_cost,p_notes,auth.uid(),v_out_key) RETURNING * INTO v_primary;
    INSERT INTO tank_movements(station_id,fuel_type_id,tank_id,counterparty_tank_id,movement_type,quantity_litres,reference_type,reference_id,unit_cost,notes,created_by,idempotency_key)
    VALUES(p_station,p_fuel,p_counterparty,p_tank,'transfer_in',p_quantity,p_reference_type,p_reference_id,p_unit_cost,p_notes,auth.uid(),v_in_key) RETURNING * INTO v_counter;
    RETURN jsonb_build_object('movement',to_jsonb(v_primary),'counter_movement',to_jsonb(v_counter),'duplicate',false);
  END IF;

  v_expected_qty := CASE WHEN p_type IN ('sale','wastage') THEN -p_quantity ELSE p_quantity END;
  IF p_idempotency_key IS NOT NULL THEN
    SELECT * INTO v_primary FROM tank_movements WHERE idempotency_key=p_idempotency_key FOR UPDATE;
    IF FOUND THEN
      IF v_primary.station_id IS DISTINCT FROM p_station OR v_primary.tank_id IS DISTINCT FROM p_tank
         OR v_primary.fuel_type_id IS DISTINCT FROM p_fuel OR v_primary.quantity_litres IS DISTINCT FROM v_expected_qty
      THEN RAISE EXCEPTION 'Idempotency key already belongs to a different tank movement'; END IF;
      RETURN jsonb_build_object('movement',to_jsonb(v_primary),'duplicate',true);
    END IF;
  END IF;

  INSERT INTO tank_movements(station_id,fuel_type_id,tank_id,movement_type,quantity_litres,reference_type,reference_id,unit_cost,notes,created_by,idempotency_key)
  VALUES(p_station,p_fuel,p_tank,
    CASE p_type WHEN 'delivery' THEN 'delivery' WHEN 'sale' THEN 'sale' WHEN 'wastage' THEN 'wastage' WHEN 'adjustment' THEN 'adjustment' WHEN 'opening' THEN 'opening' WHEN 'closing' THEN 'closing' END,
    v_expected_qty,p_reference_type,p_reference_id,p_unit_cost,p_notes,auth.uid(),p_idempotency_key)
  RETURNING * INTO v_primary;
  RETURN jsonb_build_object('movement',to_jsonb(v_primary),'duplicate',false);
EXCEPTION WHEN unique_violation THEN
  IF p_idempotency_key IS NOT NULL THEN
    SELECT * INTO v_primary FROM tank_movements WHERE idempotency_key=p_idempotency_key;
    IF FOUND THEN
      IF v_primary.station_id IS DISTINCT FROM p_station OR v_primary.tank_id IS DISTINCT FROM p_tank
         OR v_primary.fuel_type_id IS DISTINCT FROM p_fuel OR v_primary.quantity_litres IS DISTINCT FROM v_expected_qty
      THEN RAISE EXCEPTION 'Idempotency key already belongs to a different tank movement'; END IF;
      RETURN jsonb_build_object('movement',to_jsonb(v_primary),'duplicate',true);
    END IF;
  END IF;
  RAISE;
END;
$$;

COMMIT;
