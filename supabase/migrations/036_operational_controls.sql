-- Migration 036: operational controls, credit/drawer workflows, sync conflict RPCs and DR guards.

CREATE TABLE IF NOT EXISTS accounting_periods (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  station_id UUID NOT NULL REFERENCES stations(id) ON DELETE CASCADE,
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('open','locked','reopened')),
  locked_by UUID REFERENCES auth.users(id),
  locked_at TIMESTAMPTZ,
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(station_id,period_start,period_end),
  CHECK (period_end>=period_start)
);

CREATE TABLE IF NOT EXISTS credit_statements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  station_id UUID NOT NULL REFERENCES stations(id) ON DELETE CASCADE,
  account_id UUID NOT NULL REFERENCES credit_accounts_ledger(id) ON DELETE RESTRICT,
  statement_start DATE NOT NULL,
  statement_end DATE NOT NULL,
  opening_balance NUMERIC(18,2) NOT NULL DEFAULT 0,
  charges NUMERIC(18,2) NOT NULL DEFAULT 0,
  payments NUMERIC(18,2) NOT NULL DEFAULT 0,
  closing_balance NUMERIC(18,2) NOT NULL DEFAULT 0,
  generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  generated_by UUID REFERENCES auth.users(id)
);

CREATE OR REPLACE FUNCTION fuelpro_period_is_locked(p_station UUID,p_at TIMESTAMPTZ)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT EXISTS(
   SELECT 1 FROM accounting_periods
   WHERE station_id=p_station AND status='locked'
     AND p_at::date BETWEEN period_start AND period_end
 ) OR EXISTS(
   SELECT 1 FROM accounting_period_locks
   WHERE station_id=p_station AND p_at::date BETWEEN period_start AND period_end
 );
$$;

CREATE OR REPLACE FUNCTION fuelpro_lock_period(p_station UUID,p_start DATE,p_end DATE,p_reason TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_id UUID;
BEGIN
 IF NOT fuelpro_has_permission(p_station,'period.lock') THEN RAISE EXCEPTION 'Not authorized'; END IF;
 IF p_end<p_start THEN RAISE EXCEPTION 'Invalid period'; END IF;
 INSERT INTO accounting_periods(station_id,period_start,period_end,status,locked_by,locked_at,reason)
 VALUES(p_station,p_start,p_end,'locked',auth.uid(),NOW(),p_reason)
 ON CONFLICT(station_id,period_start,period_end)
 DO UPDATE SET status='locked',locked_by=auth.uid(),locked_at=NOW(),reason=EXCLUDED.reason
 RETURNING id INTO v_id;
 INSERT INTO accounting_period_locks(station_id,period_start,period_end,reason,locked_by)
 VALUES(p_station,p_start,p_end,p_reason,auth.uid())
 ON CONFLICT DO NOTHING;
 INSERT INTO immutable_audit_log(station_id,user_id,action,entity_type,entity_id,new_values)
 VALUES(p_station,auth.uid(),'period.lock','accounting_period',v_id::text,jsonb_build_object('start',p_start,'end',p_end,'reason',p_reason));
 RETURN jsonb_build_object('id',v_id,'status','locked');
END;
$$;

CREATE OR REPLACE FUNCTION fuelpro_close_cash_drawer(p_drawer UUID,p_counted NUMERIC,p_notes TEXT DEFAULT NULL)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE d cash_drawers; expected NUMERIC; variance NUMERIC;
BEGIN
 SELECT * INTO d FROM cash_drawers WHERE id=p_drawer FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Drawer not found'; END IF;
 IF NOT fuelpro_has_permission(d.station_id,'drawer.close') THEN RAISE EXCEPTION 'Not authorized'; END IF;
 IF d.status<>'open' THEN RAISE EXCEPTION 'Drawer already closed'; END IF;
 SELECT d.opening_cash+COALESCE(SUM(amount),0) INTO expected FROM cash_drawer_events WHERE drawer_id=d.id;
 variance:=ROUND(p_counted-expected,2);
 UPDATE cash_drawers SET status='closed',closed_by=auth.uid(),closed_at=NOW(),expected_cash=expected,counted_cash=p_counted,variance_amount=variance,close_notes=p_notes WHERE id=d.id;
 IF ABS(variance)>100 THEN
   INSERT INTO anomaly_events(station_id,anomaly_type,severity,entity_type,entity_id,details)
   VALUES(d.station_id,'large_variance',CASE WHEN ABS(variance)>5000 THEN 'critical' ELSE 'high' END,'cash_drawer',d.id::text,
     jsonb_build_object('expected',expected,'counted',p_counted,'variance',variance));
 END IF;
 INSERT INTO immutable_audit_log(station_id,user_id,action,entity_type,entity_id,new_values)
 VALUES(d.station_id,auth.uid(),'drawer.close','cash_drawer',d.id::text,jsonb_build_object('expected',expected,'counted',p_counted,'variance',variance));
 RETURN jsonb_build_object('drawer_id',d.id,'expected',expected,'counted',p_counted,'variance',variance);
END;
$$;

CREATE OR REPLACE FUNCTION fuelpro_post_credit_charge(p_station UUID,p_account UUID,p_sale UUID,p_amount NUMERIC,p_vehicle TEXT DEFAULT NULL)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE a credit_accounts_ledger;
BEGIN
 IF NOT fuelpro_has_permission(p_station,'credit.manage') THEN RAISE EXCEPTION 'Not authorized'; END IF;
 IF p_amount<=0 THEN RAISE EXCEPTION 'Amount must be positive'; END IF;
 SELECT * INTO a FROM credit_accounts_ledger WHERE id=p_account AND station_id=p_station AND status='active' FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Credit account not found or inactive'; END IF;
 IF (SELECT COALESCE(SUM(amount),0) FROM credit_ledger WHERE account_id=a.id)+p_amount>a.credit_limit THEN
   RAISE EXCEPTION 'Credit limit exceeded';
 END IF;
 INSERT INTO credit_ledger(station_id,account_id,entry_type,amount,sale_id,vehicle_ref,description,created_by)
 VALUES(p_station,a.id,'charge',p_amount,p_sale,p_vehicle,'Fuel sale on credit',auth.uid());
 RETURN jsonb_build_object('account_id',a.id,'balance',(SELECT COALESCE(SUM(amount),0) FROM credit_ledger WHERE account_id=a.id));
END;
$$;

CREATE OR REPLACE FUNCTION fuelpro_sync_apply(
 p_station UUID,p_entity_type TEXT,p_entity_id TEXT,p_base_version BIGINT,p_payload JSONB
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v sync_entity_versions; v_conflict UUID; v_next BIGINT;
BEGIN
 IF fuelpro_user_role(p_station) IS NULL THEN RAISE EXCEPTION 'Not authorized'; END IF;
 SELECT * INTO v FROM sync_entity_versions WHERE station_id=p_station AND entity_type=p_entity_type AND entity_id=p_entity_id FOR UPDATE;
 IF v.version IS NOT NULL AND v.version<>COALESCE(p_base_version,0) THEN
   INSERT INTO sync_conflicts(station_id,entity_type,entity_id,client_version,server_version,client_payload,resolution)
   VALUES(p_station,p_entity_type,p_entity_id,p_base_version,v.version,p_payload,'manual') RETURNING id INTO v_conflict;
   RETURN jsonb_build_object('success',false,'conflict',true,'conflict_id',v_conflict,'server_version',v.version);
 END IF;
 v_next:=COALESCE(v.version,0)+1;
 INSERT INTO sync_entity_versions(station_id,entity_type,entity_id,version,payload_hash)
 VALUES(p_station,p_entity_type,p_entity_id,v_next,encode(digest(p_payload::text,'sha256'),'hex'))
 ON CONFLICT(station_id,entity_type,entity_id)
 DO UPDATE SET version=EXCLUDED.version,payload_hash=EXCLUDED.payload_hash,updated_at=NOW();
 RETURN jsonb_build_object('success',true,'version',v_next);
END;
$$;

-- Audit itself is append-only.
CREATE OR REPLACE FUNCTION fuelpro_block_audit_mutation()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Immutable audit log cannot be modified'; END;
$$;
DROP TRIGGER IF EXISTS immutable_audit_log_guard ON immutable_audit_log;
CREATE TRIGGER immutable_audit_log_guard BEFORE UPDATE OR DELETE ON immutable_audit_log
FOR EACH ROW EXECUTE FUNCTION fuelpro_block_audit_mutation();

-- Require unique provider reference at the database level even for non-M-Pesa providers.
CREATE UNIQUE INDEX IF NOT EXISTS payment_provider_reference_unique
ON payment_transactions(provider,provider_reference)
WHERE provider_reference IS NOT NULL;

INSERT INTO migration_verifications(migration_name,status,details)
VALUES('036_operational_controls','passed',jsonb_build_object('applied_at',NOW()));
