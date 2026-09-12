BEGIN;
SET LOCAL ROLE app_owner;
INSERT INTO app.permissions VALUES ('inventory.transfer','Flytte lager');
ALTER TABLE app.inventory_entries DROP CONSTRAINT inventory_entries_kind_check;
ALTER TABLE app.inventory_entries ADD CONSTRAINT inventory_entries_kind_check CHECK(kind IN ('correction','reversal','receipt','transfer'));
CREATE INDEX inventory_transfer_time ON app.inventory_entries(company_id,posted_at DESC,id) WHERE kind='transfer';
DROP POLICY entries_insert ON app.inventory_entries;
CREATE POLICY entries_insert ON app.inventory_entries FOR INSERT TO app_runtime WITH CHECK(company_id=app.company_id() AND app.allowed('inventory.read') AND ((kind='receipt' AND app.allowed('inventory.receive')) OR (kind='transfer' AND app.allowed('inventory.transfer')) OR (kind IN ('correction','reversal') AND app.allowed('inventory.adjust'))));
CREATE OR REPLACE FUNCTION app_private.prepare_inventory() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE supplier app.suppliers; dimension text; amount text; a jsonb; b jsonb;
BEGIN
 IF NEW.company_id IS DISTINCT FROM app.company_id() OR NOT app.session_active() OR EXISTS(SELECT 1 FROM app.revoked_sessions WHERE session_id=nullif(current_setting('app.session_id',true),'')::uuid) OR NOT app.allowed('inventory.read') OR NOT app.allowed(CASE WHEN NEW.kind='receipt' THEN 'inventory.receive' WHEN NEW.kind='transfer' THEN 'inventory.transfer' ELSE 'inventory.adjust' END) THEN RAISE EXCEPTION 'Permission denied' USING ERRCODE='42501'; END IF;
 NEW.actor_id:=app.actor_id();NEW.posted_at:=clock_timestamp();
 IF NEW.kind IN ('correction','receipt','transfer') THEN
  IF NEW.reverses_id IS NOT NULL OR jsonb_typeof(NEW.request)<>'array' OR jsonb_array_length(NEW.request) NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'Invalid inventory request' USING ERRCODE='23514'; END IF;
  IF NEW.kind='transfer' THEN
   IF jsonb_array_length(NEW.request)<>2 THEN RAISE EXCEPTION 'Transfer requires two lines' USING ERRCODE='23514'; END IF;
   a:=NEW.request->0;b:=NEW.request->1;
   IF a->>'item_id' IS DISTINCT FROM b->>'item_id' OR a->>'owner_id' IS DISTINCT FROM b->>'owner_id' OR a->>'location_id' IS NOT DISTINCT FROM b->>'location_id' THEN RAISE EXCEPTION 'Transfer must preserve item and owner between different locations' USING ERRCODE='23514'; END IF;
   IF coalesce(a->>'quantity','')!~'^-(0|[1-9][0-9]{0,11})(\.[0-9]{1,8})?$' OR coalesce(b->>'quantity','')!~'^(0|[1-9][0-9]{0,11})(\.[0-9]{1,8})?$' THEN RAISE EXCEPTION 'Invalid transfer quantity' USING ERRCODE='23514'; END IF;
   IF (a->>'quantity')::numeric>=0 OR (b->>'quantity')::numeric<=0 OR (a->>'quantity')::numeric+(b->>'quantity')::numeric<>0 THEN RAISE EXCEPTION 'Transfer quantities must balance' USING ERRCODE='23514'; END IF;
  END IF;
  IF NEW.kind='receipt' THEN
   IF jsonb_array_length(NEW.request)<>1 THEN RAISE EXCEPTION 'A receipt requires one stock line' USING ERRCODE='23514'; END IF;
   amount:=NEW.request->0->>'quantity';
   IF amount IS NULL OR amount!~'^(0|[1-9][0-9]{0,11})(\.[0-9]{1,8})?$' THEN RAISE EXCEPTION 'Invalid received quantity' USING ERRCODE='23514'; END IF;
   IF amount::numeric<=0 THEN RAISE EXCEPTION 'Received quantity must be positive' USING ERRCODE='23514'; END IF;
   NEW.receipt_received_at:=NEW.posted_at;
   NEW.receipt_supplier_snapshot:=NULL;
   IF NEW.receipt_supplier_id IS NOT NULL THEN
    SELECT * INTO supplier FROM app.suppliers WHERE company_id=NEW.company_id AND id=NEW.receipt_supplier_id FOR SHARE;
    IF supplier.id IS NULL OR NOT supplier.active THEN RAISE EXCEPTION 'Active supplier in same company required' USING ERRCODE='23514'; END IF;
    NEW.receipt_supplier_snapshot:=jsonb_build_object('id',supplier.id,'code',supplier.code,'name',supplier.name);
   END IF;
   SELECT u.dimension INTO dimension FROM app.items i JOIN app.units u ON u.company_id=i.company_id AND u.id=i.unit_id WHERE i.company_id=NEW.company_id AND i.id=(NEW.request->0->>'item_id')::uuid;
   IF dimension IN ('count','package') AND NEW.receipt_expected_quantity<>trunc(NEW.receipt_expected_quantity) THEN RAISE EXCEPTION 'Whole expected units required' USING ERRCODE='23514'; END IF;
  END IF;
 ELSE
  IF NEW.kind<>'reversal' OR NEW.request<>'[]'::jsonb OR NOT EXISTS(SELECT 1 FROM app.inventory_entries WHERE company_id=NEW.company_id AND id=NEW.reverses_id AND kind IN ('correction','receipt','transfer')) THEN RAISE EXCEPTION 'Invalid reversal' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $$;
RESET ROLE;
COMMIT;
