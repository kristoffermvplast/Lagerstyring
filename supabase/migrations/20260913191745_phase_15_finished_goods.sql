-- Phase 15: order-attributed finished stock and individual handling units.
BEGIN;
SET LOCAL ROLE app_owner;
INSERT INTO app.permissions VALUES ('production.deliver','Aflevere færdigvarer'),('production.delivery.correct','Modpostere færdigvareaflevering');
CREATE TABLE app.production_deliveries (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid NOT NULL, order_id uuid NOT NULL,
 idempotency_key uuid NOT NULL,kind text NOT NULL CHECK(kind IN ('delivery','reversal')),
 quantity numeric(20,8) NOT NULL CHECK(quantity>0 AND quantity<'Infinity'::numeric),
 owner_id uuid NOT NULL,location_id uuid NOT NULL,pallet_type_id uuid,
 production_date date NOT NULL,comment text NOT NULL DEFAULT '' CHECK(length(comment)<=2000),
 reverses_id uuid,entry_id uuid NOT NULL DEFAULT gen_random_uuid(),snapshot jsonb NOT NULL DEFAULT '{}',
 created_by uuid NOT NULL DEFAULT app.actor_id() REFERENCES app.profiles,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(company_id,id),UNIQUE(company_id,idempotency_key),UNIQUE(company_id,reverses_id),UNIQUE(company_id,entry_id),
 FOREIGN KEY(company_id,order_id) REFERENCES app.production_orders(company_id,id),
 FOREIGN KEY(company_id,owner_id) REFERENCES app.stock_owners(company_id,id),
 FOREIGN KEY(company_id,location_id) REFERENCES app.locations(company_id,id),
 FOREIGN KEY(company_id,pallet_type_id) REFERENCES app.pallet_types(company_id,id),
 FOREIGN KEY(company_id,reverses_id) REFERENCES app.production_deliveries(company_id,id),
 FOREIGN KEY(company_id,entry_id) REFERENCES app.inventory_entries(company_id,id) DEFERRABLE INITIALLY DEFERRED,
 CHECK((kind='reversal')=(reverses_id IS NOT NULL))
);
CREATE INDEX deliveries_order ON app.production_deliveries(company_id,order_id,created_at,id);
CREATE TABLE app.handling_units (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),company_id uuid NOT NULL,delivery_id uuid NOT NULL,
 code text NOT NULL,location_id uuid NOT NULL,active boolean NOT NULL DEFAULT true,
 UNIQUE(company_id,id),UNIQUE(company_id,code),UNIQUE(company_id,delivery_id),
 FOREIGN KEY(company_id,delivery_id) REFERENCES app.production_deliveries(company_id,id),
 FOREIGN KEY(company_id,location_id) REFERENCES app.locations(company_id,id)
);
CREATE INDEX handling_units_location ON app.handling_units(company_id,location_id) WHERE active;
CREATE TABLE app.handling_unit_moves (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),company_id uuid NOT NULL,handling_unit_id uuid NOT NULL,idempotency_key uuid NOT NULL,
 from_location_id uuid NOT NULL,to_location_id uuid NOT NULL,entry_id uuid NOT NULL DEFAULT gen_random_uuid(),
 comment text NOT NULL CHECK(length(trim(comment)) BETWEEN 3 AND 2000),snapshot jsonb NOT NULL DEFAULT '{}',
 created_by uuid NOT NULL DEFAULT app.actor_id() REFERENCES app.profiles,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(company_id,idempotency_key),UNIQUE(company_id,entry_id),
 FOREIGN KEY(company_id,handling_unit_id) REFERENCES app.handling_units(company_id,id),
 FOREIGN KEY(company_id,from_location_id) REFERENCES app.locations(company_id,id),
 FOREIGN KEY(company_id,to_location_id) REFERENCES app.locations(company_id,id),
 FOREIGN KEY(company_id,entry_id) REFERENCES app.inventory_entries(company_id,id) DEFERRABLE INITIALLY DEFERRED,
 CHECK(from_location_id<>to_location_id)
);
CREATE INDEX handling_unit_moves_history ON app.handling_unit_moves(company_id,handling_unit_id,created_at,id);
ALTER TABLE app.production_deliveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.handling_units ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.handling_unit_moves ENABLE ROW LEVEL SECURITY;
CREATE POLICY read ON app.production_deliveries FOR SELECT TO app_runtime USING(company_id=app.company_id() AND app.allowed('production.read') AND app.allowed('inventory.read'));
CREATE POLICY write ON app.production_deliveries FOR INSERT TO app_runtime WITH CHECK(company_id=app.company_id() AND app.allowed('production.read') AND app.allowed('inventory.read') AND app.allowed(CASE WHEN kind='reversal' THEN 'production.delivery.correct' ELSE 'production.deliver' END));
CREATE POLICY read ON app.handling_units FOR SELECT TO app_runtime USING(company_id=app.company_id() AND app.allowed('inventory.read') AND app.allowed('production.read'));
CREATE POLICY read ON app.handling_unit_moves FOR SELECT TO app_runtime USING(company_id=app.company_id() AND app.allowed('inventory.read') AND app.allowed('production.read'));
CREATE POLICY write ON app.handling_unit_moves FOR INSERT TO app_runtime WITH CHECK(company_id=app.company_id() AND app.allowed('inventory.read') AND app.allowed('production.read') AND app.allowed('inventory.transfer'));
REVOKE ALL ON app.production_deliveries,app.handling_units,app.handling_unit_moves FROM PUBLIC,anon,authenticated;
GRANT SELECT ON app.production_deliveries,app.handling_units,app.handling_unit_moves TO app_runtime;
GRANT INSERT(company_id,order_id,idempotency_key,kind,quantity,owner_id,location_id,pallet_type_id,production_date,comment,reverses_id) ON app.production_deliveries TO app_runtime;
GRANT INSERT(company_id,handling_unit_id,idempotency_key,to_location_id,comment) ON app.handling_unit_moves TO app_runtime;
CREATE TRIGGER immutable BEFORE UPDATE OR DELETE ON app.production_deliveries FOR EACH ROW EXECUTE FUNCTION app_private.inventory_immutable();
CREATE TRIGGER immutable BEFORE UPDATE OR DELETE ON app.handling_unit_moves FOR EACH ROW EXECUTE FUNCTION app_private.inventory_immutable();
ALTER TABLE app.inventory_entries DROP CONSTRAINT inventory_entries_kind_check;
ALTER TABLE app.inventory_entries ADD CONSTRAINT inventory_entries_kind_check CHECK(kind IN ('correction','reversal','receipt','transfer','production_consumption','production_output','production_output_reversal','handling_unit_move'));
-- These types are written by private document triggers only, never by runtime directly.
CREATE FUNCTION app_private.prepare_delivery() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE ord app.production_orders; original app.production_deliveries; good numeric; delivered numeric; owner app.stock_owners; loc app.locations; pallet app.pallet_types; expected_unit uuid;
BEGIN
 IF NEW.company_id IS DISTINCT FROM app.company_id() OR app.actor_id() IS NULL OR NOT app.session_active() OR EXISTS(SELECT 1 FROM app.revoked_sessions WHERE session_id=nullif(current_setting('app.session_id',true),'')::uuid) OR NOT app.allowed('production.read') OR NOT app.allowed('inventory.read') OR NOT app.allowed(CASE WHEN NEW.kind='reversal' THEN 'production.delivery.correct' ELSE 'production.deliver' END) THEN RAISE EXCEPTION 'Permission denied' USING ERRCODE='42501'; END IF;
 SELECT * INTO ord FROM app.production_orders WHERE company_id=NEW.company_id AND id=NEW.order_id FOR UPDATE;
 IF ord.id IS NULL OR ord.status NOT IN ('in_production','reconciliation','completed') THEN RAISE EXCEPTION 'Production output requires started order' USING ERRCODE='23514'; END IF;
 IF NEW.kind='reversal' THEN
  SELECT * INTO original FROM app.production_deliveries WHERE company_id=NEW.company_id AND order_id=ord.id AND id=NEW.reverses_id AND kind='delivery';
  IF original.id IS NULL OR length(trim(NEW.comment))<3 OR EXISTS(SELECT 1 FROM app.production_deliveries WHERE company_id=NEW.company_id AND reverses_id=original.id) THEN RAISE EXCEPTION 'Unreversed delivery and reason required' USING ERRCODE='23514'; END IF;
  -- A moved unit must return to its original delivery location before reversing.
  IF EXISTS(SELECT 1 FROM app.handling_units WHERE company_id=NEW.company_id AND delivery_id=original.id AND (NOT active OR location_id<>original.location_id)) THEN RAISE EXCEPTION 'Return pallet to delivery location before reversal' USING ERRCODE='23514'; END IF;
  NEW.quantity:=original.quantity;NEW.owner_id:=original.owner_id;NEW.location_id:=original.location_id;NEW.pallet_type_id:=original.pallet_type_id;NEW.production_date:=original.production_date;NEW.snapshot:=original.snapshot;
 ELSE
  SELECT coalesce(sum(CASE WHEN kind='record' THEN quantity ELSE -quantity END),0) INTO good FROM app.production_registrations WHERE company_id=NEW.company_id AND order_id=ord.id;
  SELECT coalesce(sum(CASE WHEN kind='delivery' THEN quantity ELSE -quantity END),0) INTO delivered FROM app.production_deliveries WHERE company_id=NEW.company_id AND order_id=ord.id;
  IF NEW.quantity>good-delivered THEN RAISE EXCEPTION 'Delivery exceeds registered undelivered good quantity' USING ERRCODE='23514'; END IF;
  IF NEW.production_date>current_date THEN RAISE EXCEPTION 'Future production date not allowed' USING ERRCODE='23514'; END IF;
  expected_unit:=(ord.snapshot->'unit'->>'id')::uuid;
  IF expected_unit IS NULL OR NOT EXISTS(SELECT 1 FROM app.items WHERE company_id=NEW.company_id AND id=ord.product_id AND unit_id=expected_unit AND active) THEN RAISE EXCEPTION 'Product unit must match order snapshot' USING ERRCODE='23514'; END IF;
  SELECT * INTO owner FROM app.stock_owners WHERE company_id=NEW.company_id AND id=NEW.owner_id AND active FOR SHARE;
  SELECT * INTO loc FROM app.locations WHERE company_id=NEW.company_id AND id=NEW.location_id AND active AND is_storage FOR SHARE;
  IF owner.id IS NULL OR loc.id IS NULL THEN RAISE EXCEPTION 'Active owner and storage location required' USING ERRCODE='23514'; END IF;
  IF NEW.pallet_type_id IS NOT NULL THEN SELECT * INTO pallet FROM app.pallet_types WHERE company_id=NEW.company_id AND id=NEW.pallet_type_id AND active FOR SHARE;IF pallet.id IS NULL THEN RAISE EXCEPTION 'Active pallet type required' USING ERRCODE='23514'; END IF;END IF;
  NEW.snapshot:=jsonb_build_object('order_id',ord.id,'order_code',ord.code,'order_version',ord.version,'product',ord.snapshot->'product','unit',ord.snapshot->'unit','packing',ord.snapshot->'packing','packing_overrides',ord.packing_overrides,'owner',to_jsonb(owner),'location',to_jsonb(loc),'pallet_type',CASE WHEN pallet.id IS NULL THEN NULL ELSE to_jsonb(pallet) END);
 END IF;
 NEW.created_by:=app.actor_id();NEW.created_at:=clock_timestamp();RETURN NEW;
END $$;
CREATE TRIGGER prepare BEFORE INSERT ON app.production_deliveries FOR EACH ROW EXECUTE FUNCTION app_private.prepare_delivery();
CREATE FUNCTION app_private.post_delivery() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE hu_id uuid:=gen_random_uuid();
BEGIN
 IF NEW.kind='reversal' THEN UPDATE app.handling_units SET active=false WHERE company_id=NEW.company_id AND delivery_id=NEW.reverses_id; END IF;
 INSERT INTO app.inventory_entries(id,company_id,idempotency_key,kind,reason,request,reference)
 VALUES(NEW.entry_id,NEW.company_id,NEW.entry_id,CASE WHEN NEW.kind='delivery' THEN 'production_output' ELSE 'production_output_reversal' END,'Færdigvareaflevering',jsonb_build_array(jsonb_build_object('item_id',NEW.snapshot->'product'->>'id','owner_id',NEW.owner_id,'location_id',NEW.location_id,'quantity',(CASE WHEN NEW.kind='delivery' THEN NEW.quantity ELSE -NEW.quantity END)::text)),NEW.order_id::text);
 IF NEW.kind='delivery' AND NEW.pallet_type_id IS NOT NULL THEN
  INSERT INTO app.handling_units(id,company_id,delivery_id,code,location_id) VALUES(hu_id,NEW.company_id,NEW.id,'PAL-'||hu_id::text,NEW.location_id);
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER post AFTER INSERT ON app.production_deliveries FOR EACH ROW EXECUTE FUNCTION app_private.post_delivery();
-- Protect identified stock from all generic debit paths. No balance is independently editable.
CREATE FUNCTION app_private.protect_identified_stock() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE allocated numeric;
BEGIN
 SELECT coalesce(sum(d.quantity),0) INTO allocated FROM app.handling_units h JOIN app.production_deliveries d ON d.company_id=h.company_id AND d.id=h.delivery_id WHERE h.company_id=NEW.company_id AND h.active AND h.location_id=NEW.location_id AND d.owner_id=NEW.owner_id AND d.snapshot->'product'->>'id'=NEW.item_id::text;
 IF NEW.quantity<allocated THEN RAISE EXCEPTION 'Identified pallet stock must use pallet workflow' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER identified_stock BEFORE UPDATE ON app.stock_balances FOR EACH ROW EXECUTE FUNCTION app_private.protect_identified_stock();
CREATE FUNCTION app_private.prepare_hu_move() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE hu app.handling_units; d app.production_deliveries; loc app.locations;
BEGIN
 IF NEW.company_id IS DISTINCT FROM app.company_id() OR NOT app.session_active() OR EXISTS(SELECT 1 FROM app.revoked_sessions WHERE session_id=nullif(current_setting('app.session_id',true),'')::uuid) OR NOT app.allowed('inventory.read') OR NOT app.allowed('production.read') OR NOT app.allowed('inventory.transfer') THEN RAISE EXCEPTION 'Permission denied' USING ERRCODE='42501'; END IF;
 SELECT pd.* INTO d FROM app.handling_units h JOIN app.production_deliveries pd ON pd.company_id=h.company_id AND pd.id=h.delivery_id WHERE h.company_id=NEW.company_id AND h.id=NEW.handling_unit_id;
 PERFORM 1 FROM app.production_orders WHERE company_id=NEW.company_id AND id=d.order_id FOR UPDATE;
 SELECT * INTO hu FROM app.handling_units WHERE company_id=NEW.company_id AND id=NEW.handling_unit_id FOR UPDATE;
 IF hu.id IS NULL OR NOT hu.active OR hu.location_id=NEW.to_location_id THEN RAISE EXCEPTION 'Active pallet and different destination required' USING ERRCODE='23514'; END IF;
 SELECT * INTO loc FROM app.locations WHERE company_id=NEW.company_id AND id=NEW.to_location_id AND active AND is_storage FOR SHARE;
 IF loc.id IS NULL THEN RAISE EXCEPTION 'Active storage location required' USING ERRCODE='23514'; END IF;
 NEW.from_location_id:=hu.location_id;NEW.snapshot:=jsonb_build_object('delivery',d.snapshot,'to_location',to_jsonb(loc));NEW.created_by:=app.actor_id();NEW.created_at:=clock_timestamp();RETURN NEW;
END $$;
CREATE TRIGGER prepare BEFORE INSERT ON app.handling_unit_moves FOR EACH ROW EXECUTE FUNCTION app_private.prepare_hu_move();
CREATE FUNCTION app_private.post_hu_move() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE d app.production_deliveries;
BEGIN
 SELECT pd.* INTO d FROM app.handling_units h JOIN app.production_deliveries pd ON pd.company_id=h.company_id AND pd.id=h.delivery_id WHERE h.company_id=NEW.company_id AND h.id=NEW.handling_unit_id;
 UPDATE app.handling_units SET location_id=NEW.to_location_id WHERE company_id=NEW.company_id AND id=NEW.handling_unit_id;
 INSERT INTO app.inventory_entries(id,company_id,idempotency_key,kind,reason,request,reference) VALUES(NEW.entry_id,NEW.company_id,NEW.entry_id,'handling_unit_move',NEW.comment,jsonb_build_array(
 jsonb_build_object('item_id',d.snapshot->'product'->>'id','owner_id',d.owner_id,'location_id',NEW.from_location_id,'quantity',(-d.quantity)::text),
 jsonb_build_object('item_id',d.snapshot->'product'->>'id','owner_id',d.owner_id,'location_id',NEW.to_location_id,'quantity',d.quantity::text)),NEW.handling_unit_id::text);
 RETURN NEW;
END $$;
CREATE TRIGGER post AFTER INSERT ON app.handling_unit_moves FOR EACH ROW EXECUTE FUNCTION app_private.post_hu_move();
-- Trigger sorts after the existing preparation trigger, which resolves reversal quantity.
CREATE FUNCTION app_private.registration_delivery_floor() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE good numeric; delivered numeric;
BEGIN
 IF NEW.kind='reversal' THEN
  SELECT coalesce(sum(CASE WHEN kind='record' THEN quantity ELSE -quantity END),0) INTO good FROM app.production_registrations WHERE company_id=NEW.company_id AND order_id=NEW.order_id;
  SELECT coalesce(sum(CASE WHEN kind='delivery' THEN quantity ELSE -quantity END),0) INTO delivered FROM app.production_deliveries WHERE company_id=NEW.company_id AND order_id=NEW.order_id;
  IF good-NEW.quantity<delivered THEN RAISE EXCEPTION 'Reverse deliveries before correcting registered production' USING ERRCODE='23514'; END IF;
 END IF;RETURN NEW;
END $$;
CREATE TRIGGER zz_delivery_floor BEFORE INSERT ON app.production_registrations FOR EACH ROW EXECUTE FUNCTION app_private.registration_delivery_floor();
CREATE OR REPLACE FUNCTION app_private.prepare_inventory() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE supplier app.suppliers; dimension text; amount text; a jsonb; b jsonb;
BEGIN
 IF NEW.kind IN ('production_output','production_output_reversal','handling_unit_move') THEN
  IF NEW.company_id IS DISTINCT FROM app.company_id() OR NOT app.session_active() OR EXISTS(SELECT 1 FROM app.revoked_sessions WHERE session_id=nullif(current_setting('app.session_id',true),'')::uuid) OR NOT app.allowed('inventory.read') OR NOT app.allowed('production.read') THEN RAISE EXCEPTION 'Permission denied' USING ERRCODE='42501'; END IF;
  IF NEW.production_order_id IS NOT NULL OR NEW.reverses_id IS NOT NULL THEN RAISE EXCEPTION 'Invalid output reference' USING ERRCODE='23514'; END IF;
  IF NEW.kind='handling_unit_move' THEN
   IF NOT app.allowed('inventory.transfer') OR NOT EXISTS(SELECT 1 FROM app.handling_unit_moves WHERE company_id=NEW.company_id AND entry_id=NEW.id) THEN RAISE EXCEPTION 'Pallet movement document required' USING ERRCODE='42501'; END IF;
  ELSE
   IF NOT app.allowed(CASE WHEN NEW.kind='production_output' THEN 'production.deliver' ELSE 'production.delivery.correct' END) OR NOT EXISTS(SELECT 1 FROM app.production_deliveries WHERE company_id=NEW.company_id AND entry_id=NEW.id AND (kind='delivery')=(NEW.kind='production_output')) THEN RAISE EXCEPTION 'Delivery document required' USING ERRCODE='42501'; END IF;
  END IF;
  NEW.actor_id:=app.actor_id();NEW.posted_at:=clock_timestamp();RETURN NEW;
 END IF;
 IF NEW.company_id IS DISTINCT FROM app.company_id() OR NOT app.session_active() OR EXISTS(SELECT 1 FROM app.revoked_sessions WHERE session_id=nullif(current_setting('app.session_id',true),'')::uuid) OR NOT app.allowed('inventory.read') OR NOT app.allowed(CASE WHEN NEW.kind='receipt' THEN 'inventory.receive' WHEN NEW.kind='transfer' THEN 'inventory.transfer' WHEN NEW.kind='production_consumption' THEN 'production.close' ELSE 'inventory.adjust' END) THEN RAISE EXCEPTION 'Permission denied' USING ERRCODE='42501'; END IF;
 NEW.actor_id:=app.actor_id();NEW.posted_at:=clock_timestamp();
 IF NEW.kind='production_consumption' THEN
  IF NEW.production_closure_id IS NULL OR NEW.reverses_id IS NOT NULL OR NOT EXISTS(SELECT 1 FROM app.production_closures WHERE company_id=NEW.company_id AND id=NEW.production_closure_id AND order_id=NEW.production_order_id AND snapshot->'consumption'=NEW.request) THEN RAISE EXCEPTION 'Invalid closure consumption' USING ERRCODE='23514'; END IF;
 ELSIF NEW.kind IN ('correction','receipt','transfer') THEN
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

REVOKE ALL ON FUNCTION app_private.prepare_delivery(),app_private.post_delivery(),app_private.protect_identified_stock(),app_private.prepare_hu_move(),app_private.post_hu_move(),app_private.registration_delivery_floor() FROM PUBLIC,anon,authenticated,app_runtime;
RESET ROLE;
COMMIT;
