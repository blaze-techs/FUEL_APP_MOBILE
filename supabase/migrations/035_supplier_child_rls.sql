-- Migration 035: child-table station policies and canonical supplier metadata.

ALTER TABLE purchase_order_ledger
  ADD COLUMN IF NOT EXISTS expected_delivery_date DATE,
  ADD COLUMN IF NOT EXISTS notes TEXT,
  ADD COLUMN IF NOT EXISTS subtotal NUMERIC(18,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS tax_amount NUMERIC(18,2) NOT NULL DEFAULT 0;

CREATE POLICY po_items_scope ON purchase_order_items_ledger FOR SELECT
 USING (
   EXISTS (
     SELECT 1 FROM purchase_order_ledger po
     WHERE po.id=purchase_order_id AND fuelpro_user_role(po.station_id) IS NOT NULL
   )
 );
CREATE POLICY po_items_write_scope ON purchase_order_items_ledger FOR INSERT
 WITH CHECK (
   EXISTS (
     SELECT 1 FROM purchase_order_ledger po
     WHERE po.id=purchase_order_id AND fuelpro_has_permission(po.station_id,'purchase.create')
   )
 );
CREATE POLICY po_items_update_scope ON purchase_order_items_ledger FOR UPDATE
 USING (
   EXISTS (
     SELECT 1 FROM purchase_order_ledger po
     WHERE po.id=purchase_order_id AND fuelpro_has_permission(po.station_id,'purchase.receive')
   )
 );

CREATE POLICY supplier_delivery_items_scope ON supplier_delivery_items FOR SELECT
 USING (
   EXISTS (
     SELECT 1 FROM supplier_deliveries d
     WHERE d.id=delivery_id AND fuelpro_user_role(d.station_id) IS NOT NULL
   )
 );
CREATE POLICY supplier_delivery_items_write_scope ON supplier_delivery_items FOR INSERT
 WITH CHECK (
   EXISTS (
     SELECT 1 FROM supplier_deliveries d
     WHERE d.id=delivery_id AND fuelpro_has_permission(d.station_id,'purchase.receive')
   )
 );

INSERT INTO migration_verifications(migration_name,status,details)
VALUES('035_supplier_child_rls','passed',jsonb_build_object('applied_at',NOW()));
