-- Shipment projections are changed only by immutable, tenant-authorized commands.
BEGIN;
SET LOCAL ROLE app_owner;
INSERT INTO app.permissions VALUES ('shipments.read','Se forsendelser'),('shipments.manage','Planlægge forsendelser'),('shipments.dispatch','Afsende forsendelser');
CREATE TABLE app.shipments (
 id uuid PRIMARY KEY,company_id uuid NOT NULL REFERENCES app.companies,code text NOT NULL,
 status text NOT NULL CHECK(status IN ('draft','planned','reserved','ready','dispatched','cancelled')),
 version integer NOT NULL CHECK(version>0),customer_id uuid NOT NULL,
 ship_date date NOT NULL,reference text NOT NULL,carrier text NOT NULL,notes text NOT NULL,
 snapshot jsonb NOT NULL,lines jsonb NOT NULL CHECK(jsonb_typeof(lines)='array'),entry_id uuid,
 created_by uuid NOT NULL REFERENCES app.profiles,created_at timestamptz NOT NULL,updated_at timestamptz NOT NULL,dispatched_at timestamptz,
 UNIQUE(company_id,id),UNIQUE(company_id,code),UNIQUE(company_id,entry_id),
 FOREIGN KEY(company_id,customer_id) REFERENCES app.customers(company_id,id),
 FOREIGN KEY(company_id,entry_id) REFERENCES app.inventory_entries(company_id,id) DEFERRABLE INITIALLY DEFERRED,
 CHECK((status='dispatched')=(entry_id IS NOT NULL)),CHECK((status='dispatched')=(dispatched_at IS NOT NULL))
);
ALTER TABLE app.handling_units ADD COLUMN shipment_id uuid, ADD COLUMN shipped_at timestamptz;
ALTER TABLE app.handling_units ADD FOREIGN KEY(company_id,shipment_id) REFERENCES app.shipments(company_id,id);
ALTER TABLE app.handling_units ADD CHECK((shipment_id IS NULL)=(shipped_at IS NULL)), ADD CHECK(shipment_id IS NULL OR NOT active);
CREATE INDEX handling_units_shipment ON app.handling_units(company_id,shipment_id) WHERE shipment_id IS NOT NULL;
CREATE INDEX shipments_schedule ON app.shipments(company_id,status,ship_date,id);
CREATE INDEX shipments_customer ON app.shipments(company_id,customer_id,ship_date);
CREATE TABLE app.shipment_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),company_id uuid NOT NULL REFERENCES app.companies,shipment_id uuid NOT NULL,idempotency_key uuid NOT NULL,
 action text NOT NULL CHECK(action IN ('create','edit','plan','reserve','ready','dispatch','cancel')),
 expected_version integer NOT NULL CHECK(expected_version>=0),request jsonb NOT NULL CHECK(jsonb_typeof(request)='object'),reason text NOT NULL CHECK(length(trim(reason)) BETWEEN 3 AND 1000),
 actor_id uuid NOT NULL REFERENCES app.profiles,created_at timestamptz NOT NULL,result jsonb NOT NULL,
 UNIQUE(company_id,idempotency_key),
 FOREIGN KEY(company_id,shipment_id) REFERENCES app.shipments(company_id,id) DEFERRABLE INITIALLY DEFERRED
);
CREATE INDEX shipment_events_history ON app.shipment_events(company_id,shipment_id,created_at,id);
CREATE TABLE app.shipment_reservations (
 company_id uuid NOT NULL,shipment_id uuid NOT NULL,line_number integer NOT NULL,reservation_id uuid NOT NULL,
 PRIMARY KEY(company_id,shipment_id,line_number),UNIQUE(company_id,reservation_id),
 FOREIGN KEY(company_id,shipment_id) REFERENCES app.shipments(company_id,id),
 FOREIGN KEY(company_id,reservation_id) REFERENCES app.stock_reservations(company_id,id)
);
ALTER TABLE app.shipments ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.shipment_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.shipment_reservations ENABLE ROW LEVEL SECURITY;
CREATE POLICY read ON app.shipments FOR SELECT TO app_runtime USING(company_id=app.company_id() AND app.allowed('shipments.read'));
CREATE POLICY read ON app.shipment_events FOR SELECT TO app_runtime USING(company_id=app.company_id() AND app.allowed('shipments.read'));
CREATE POLICY read ON app.shipment_reservations FOR SELECT TO app_runtime USING(company_id=app.company_id() AND app.allowed('shipments.read'));
CREATE POLICY write ON app.shipment_events FOR INSERT TO app_runtime WITH CHECK(company_id=app.company_id() AND app.allowed('shipments.read') AND app.allowed(CASE WHEN action='dispatch' THEN 'shipments.dispatch' ELSE 'shipments.manage' END));
REVOKE ALL ON app.shipments,app.shipment_events,app.shipment_reservations FROM PUBLIC,anon,authenticated;
GRANT SELECT ON app.shipments,app.shipment_events,app.shipment_reservations TO app_runtime;
GRANT INSERT(company_id,shipment_id,idempotency_key,action,expected_version,request,reason) ON app.shipment_events TO app_runtime;
CREATE TRIGGER immutable BEFORE UPDATE OR DELETE ON app.shipment_events FOR EACH ROW EXECUTE FUNCTION app_private.inventory_immutable();
CREATE TRIGGER immutable BEFORE UPDATE OR DELETE ON app.shipment_reservations FOR EACH ROW EXECUTE FUNCTION app_private.inventory_immutable();
-- Linked reservations can only be released by a terminal shipment command in the same transaction.
CREATE FUNCTION app_private.protect_shipment_reservation() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF NEW.kind='release' AND EXISTS(SELECT 1 FROM app.shipment_reservations r JOIN app.shipments s ON s.company_id=r.company_id AND s.id=r.shipment_id WHERE r.company_id=NEW.company_id AND r.reservation_id=NEW.reservation_id AND s.status NOT IN ('cancelled','dispatched')) THEN RAISE EXCEPTION 'Reservation belongs to shipment' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER shipment_guard BEFORE INSERT ON app.reservation_events FOR EACH ROW EXECUTE FUNCTION app_private.protect_shipment_reservation();
CREATE FUNCTION app_private.command_shipment() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE s app.shipments;c app.customers;i app.items;o app.stock_owners;l app.locations;u app.units;h app.handling_units;d app.production_deliveries; rr app.stock_reservations;
 line jsonb; cooked jsonb:='[]';reservation uuid;idx integer:=0; journal jsonb;next_status text; packing jsonb; rev app.recipe_revisions;
BEGIN
 IF NEW.company_id IS DISTINCT FROM app.company_id() OR NOT app.session_active() OR EXISTS(SELECT 1 FROM app.revoked_sessions WHERE session_id=nullif(current_setting('app.session_id',true),'')::uuid) OR NOT app.allowed('shipments.read') OR NOT app.allowed(CASE WHEN NEW.action='dispatch' THEN 'shipments.dispatch' ELSE 'shipments.manage' END) THEN RAISE EXCEPTION 'Permission denied' USING ERRCODE='42501'; END IF;
 NEW.actor_id:=app.actor_id();NEW.created_at:=clock_timestamp();
 SELECT * INTO s FROM app.shipments WHERE company_id=NEW.company_id AND id=NEW.shipment_id FOR UPDATE;
 IF NEW.action='create' THEN
  IF s.id IS NOT NULL OR NEW.expected_version<>0 THEN RAISE EXCEPTION 'Invalid creation' USING ERRCODE='23514'; END IF;
 ELSE
  IF s.id IS NULL OR s.version<>NEW.expected_version OR s.status IN ('dispatched','cancelled') THEN RAISE EXCEPTION 'Stale or closed shipment' USING ERRCODE='23514'; END IF;
 END IF;
 IF NEW.action IN ('create','edit') THEN
  IF NEW.action='edit' AND s.status<>'draft' THEN RAISE EXCEPTION 'Only draft is editable' USING ERRCODE='23514'; END IF;
  IF NOT app.allowed('masterdata.read') OR NOT app.allowed('inventory.read') THEN RAISE EXCEPTION 'Permission denied' USING ERRCODE='42501'; END IF;
  IF NOT(NEW.request ?& ARRAY['code','customer_id','ship_date','reference','carrier','notes','lines']) OR NEW.request-ARRAY['code','customer_id','ship_date','reference','carrier','notes','lines']<>'{}'::jsonb OR coalesce(length(trim(NEW.request->>'code')),0) NOT BETWEEN 1 AND 60 OR length(NEW.request->>'reference')>160 OR length(NEW.request->>'carrier')>160 OR length(NEW.request->>'notes')>4000 OR coalesce(NEW.request->>'ship_date','')!~'^\d{4}-\d{2}-\d{2}$' OR jsonb_typeof(NEW.request->'lines')<>'array' OR jsonb_array_length(NEW.request->'lines') NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'Invalid shipment' USING ERRCODE='23514'; END IF;
  SELECT * INTO c FROM app.customers WHERE company_id=NEW.company_id AND id=(NEW.request->>'customer_id')::uuid AND active FOR SHARE;
  IF c.id IS NULL THEN RAISE EXCEPTION 'Active customer required' USING ERRCODE='23514'; END IF;
  FOR line IN SELECT value FROM jsonb_array_elements(NEW.request->'lines') LOOP
   IF NOT(line ?& ARRAY['item_id','owner_id','location_id','handling_unit_id','quantity','packing_revision_id','pallet_spaces']) OR line-ARRAY['item_id','owner_id','location_id','handling_unit_id','quantity','packing_revision_id','pallet_spaces']<>'{}'::jsonb OR jsonb_typeof(line->'quantity')<>'string' OR coalesce(line->>'quantity','')!~'^(0|[1-9][0-9]{0,11})(\.[0-9]{1,8})?$' OR (line->>'quantity')::numeric<=0 OR coalesce(line->>'pallet_spaces','0')!~'^(0|[1-9][0-9]{0,7})(\.[0-9]{1,4})?$' THEN RAISE EXCEPTION 'Invalid shipment line' USING ERRCODE='23514'; END IF;
   SELECT * INTO i FROM app.items WHERE company_id=NEW.company_id AND id=(line->>'item_id')::uuid AND active FOR SHARE;
   SELECT * INTO o FROM app.stock_owners WHERE company_id=NEW.company_id AND id=(line->>'owner_id')::uuid AND active FOR SHARE;
   SELECT * INTO l FROM app.locations WHERE company_id=NEW.company_id AND id=(line->>'location_id')::uuid AND active AND is_storage FOR SHARE;
   SELECT * INTO u FROM app.units WHERE company_id=NEW.company_id AND id=i.unit_id AND active FOR SHARE;
   IF i.id IS NULL OR o.id IS NULL OR l.id IS NULL OR u.id IS NULL OR (u.dimension IN ('count','package') AND (line->>'quantity')::numeric<>trunc((line->>'quantity')::numeric)) THEN RAISE EXCEPTION 'Active references and valid units required' USING ERRCODE='23514'; END IF;
   packing:=NULL;h:=NULL;d:=NULL;
   IF line->>'handling_unit_id' IS NOT NULL THEN
    IF NOT app.allowed('production.read') THEN RAISE EXCEPTION 'Permission denied' USING ERRCODE='42501'; END IF;
    SELECT * INTO h FROM app.handling_units WHERE company_id=NEW.company_id AND id=(line->>'handling_unit_id')::uuid AND active FOR SHARE;
    SELECT * INTO d FROM app.production_deliveries WHERE company_id=NEW.company_id AND id=h.delivery_id;
    IF h.id IS NULL OR h.location_id<>l.id OR d.owner_id<>o.id OR d.snapshot->'product'->>'id' IS DISTINCT FROM i.id::text OR d.quantity<>(line->>'quantity')::numeric OR line->>'packing_revision_id' IS NOT NULL THEN RAISE EXCEPTION 'Ship entire matching handling unit; use its historical packing' USING ERRCODE='23514'; END IF;
    packing:=d.snapshot->'packing';
   ELSIF line->>'packing_revision_id' IS NOT NULL THEN
    SELECT r.* INTO rev FROM app.recipe_revisions r JOIN app.recipes k ON k.company_id=r.company_id AND k.id=r.recipe_id WHERE r.company_id=NEW.company_id AND r.id=(line->>'packing_revision_id')::uuid AND r.sealed AND k.product_id=i.id AND k.kind='packing';
    IF rev.id IS NULL OR rev.snapshot->>'unit_id' IS DISTINCT FROM u.id::text THEN RAISE EXCEPTION 'Matching packing revision required' USING ERRCODE='23514'; END IF;
    packing:=to_jsonb(rev)||jsonb_build_object('base_quantity',rev.base_quantity::text,'lines',(SELECT jsonb_agg(to_jsonb(x)||jsonb_build_object('quantity',x.quantity::text) ORDER BY x.level,x.kind,x.id) FROM app.recipe_lines x WHERE x.company_id=NEW.company_id AND x.revision_id=rev.id));
   END IF;
   cooked:=cooked||jsonb_build_array(line||jsonb_build_object('snapshot',jsonb_build_object('item',jsonb_build_object('code',i.code,'name',i.name),'owner',jsonb_build_object('code',o.code,'name',o.name),'location',jsonb_build_object('code',l.code,'name',l.name),'unit',jsonb_build_object('id',u.id,'symbol',u.symbol,'dimension',u.dimension),'handling_unit_code',h.code,'production_order_id',d.order_id,'packing',packing)));
  END LOOP;
  IF NEW.action='create' THEN
   INSERT INTO app.shipments(id,company_id,code,status,version,customer_id,ship_date,reference,carrier,notes,snapshot,lines,created_by,created_at,updated_at) VALUES(NEW.shipment_id,NEW.company_id,trim(NEW.request->>'code'),'draft',1,c.id,(NEW.request->>'ship_date')::date,NEW.request->>'reference',NEW.request->>'carrier',NEW.request->>'notes',jsonb_build_object('customer',jsonb_build_object('id',c.id,'code',c.code,'name',c.name,'address',c.address)),cooked,NEW.actor_id,NEW.created_at,NEW.created_at);
  ELSE
   UPDATE app.shipments SET code=trim(NEW.request->>'code'),customer_id=c.id,ship_date=(NEW.request->>'ship_date')::date,reference=NEW.request->>'reference',carrier=NEW.request->>'carrier',notes=NEW.request->>'notes',snapshot=jsonb_build_object('customer',jsonb_build_object('id',c.id,'code',c.code,'name',c.name,'address',c.address)),lines=cooked,version=version+1,updated_at=NEW.created_at WHERE id=s.id;
  END IF;
 ELSE
  IF NEW.request<>'{}'::jsonb THEN RAISE EXCEPTION 'Unexpected command data' USING ERRCODE='23514'; END IF;
  next_status:=CASE WHEN NEW.action='plan' AND s.status='draft' THEN 'planned' WHEN NEW.action='reserve' AND s.status='planned' THEN 'reserved' WHEN NEW.action='ready' AND s.status='reserved' THEN 'ready' WHEN NEW.action='dispatch' AND s.status='ready' THEN 'dispatched' WHEN NEW.action='cancel' THEN 'cancelled' END;
  IF next_status IS NULL THEN RAISE EXCEPTION 'Invalid shipment transition' USING ERRCODE='23514'; END IF;
  IF NEW.action IN ('reserve','dispatch') OR (NEW.action='cancel' AND s.status IN ('reserved','ready')) THEN
   IF NOT app.allowed('inventory.read') OR NOT app.allowed('inventory.reserve') THEN RAISE EXCEPTION 'Permission denied' USING ERRCODE='42501'; END IF;
  END IF;
  UPDATE app.shipments SET status=next_status,version=version+1,updated_at=NEW.created_at,entry_id=CASE WHEN NEW.action='dispatch' THEN gen_random_uuid() ELSE NULL END,dispatched_at=CASE WHEN NEW.action='dispatch' THEN NEW.created_at ELSE NULL END WHERE id=s.id;
  IF NEW.action='reserve' THEN
   FOR line IN SELECT value FROM jsonb_array_elements(s.lines) LOOP
    idx:=idx+1;reservation:=gen_random_uuid();
    IF NOT EXISTS(SELECT 1 FROM app.items WHERE company_id=s.company_id AND id=(line->>'item_id')::uuid AND unit_id=(line->'snapshot'->'unit'->>'id')::uuid) THEN RAISE EXCEPTION 'Unit changed since planning' USING ERRCODE='23514'; END IF;
    INSERT INTO app.reservation_events(company_id,idempotency_key,kind,reservation_id,request,reason) VALUES(s.company_id,reservation,'reserve',reservation,(line-ARRAY['snapshot','packing_revision_id','pallet_spaces'])||jsonb_build_object('reference',s.code),NEW.reason);
    INSERT INTO app.shipment_reservations VALUES(s.company_id,s.id,idx,reservation);
   END LOOP;
  ELSIF NEW.action IN ('dispatch','cancel') AND s.status IN ('reserved','ready') THEN
   FOR rr IN SELECT r.* FROM app.stock_reservations r JOIN app.shipment_reservations x ON x.company_id=r.company_id AND x.reservation_id=r.id WHERE x.company_id=s.company_id AND x.shipment_id=s.id ORDER BY r.id FOR UPDATE OF r LOOP
    IF NOT rr.active THEN RAISE EXCEPTION 'Active shipment reservation required' USING ERRCODE='23514'; END IF;
    INSERT INTO app.reservation_events(company_id,idempotency_key,kind,reservation_id,request,reason) VALUES(s.company_id,gen_random_uuid(),'release',rr.id,'{}',NEW.reason);
    IF NEW.action='dispatch' AND rr.handling_unit_id IS NOT NULL THEN
     SELECT * INTO h FROM app.handling_units WHERE company_id=s.company_id AND id=rr.handling_unit_id FOR UPDATE;
     SELECT * INTO d FROM app.production_deliveries WHERE company_id=s.company_id AND id=h.delivery_id;
     IF NOT h.active OR h.location_id<>rr.location_id OR d.quantity<>rr.quantity OR h.reserved_quantity<>0 THEN RAISE EXCEPTION 'Matching whole pallet required' USING ERRCODE='23514'; END IF;
     UPDATE app.handling_units SET active=false,shipment_id=s.id,shipped_at=NEW.created_at WHERE id=h.id;
    END IF;
   END LOOP;
   IF NEW.action='dispatch' THEN
    SELECT * INTO s FROM app.shipments WHERE id=s.id;
    SELECT jsonb_agg(jsonb_build_object('item_id',item,'owner_id',owner,'location_id',loc,'quantity',(-qty)::text) ORDER BY item,owner,loc) INTO journal FROM (SELECT r.item_id item,r.owner_id owner,r.location_id loc,sum(r.quantity) qty FROM app.shipment_reservations x JOIN app.stock_reservations r ON r.company_id=x.company_id AND r.id=x.reservation_id WHERE x.company_id=s.company_id AND x.shipment_id=s.id GROUP BY r.item_id,r.owner_id,r.location_id) amounts;
    INSERT INTO app.inventory_entries(id,company_id,idempotency_key,kind,reason,reference,request) VALUES(s.entry_id,s.company_id,s.entry_id,'shipment',NEW.reason,s.code,journal);
   END IF;
  END IF;
 END IF;
 SELECT to_jsonb(x) INTO NEW.result FROM app.shipments x WHERE x.company_id=NEW.company_id AND x.id=NEW.shipment_id;
 RETURN NEW;
END $$;
CREATE TRIGGER command BEFORE INSERT ON app.shipment_events FOR EACH ROW EXECUTE FUNCTION app_private.command_shipment();
ALTER TABLE app.inventory_entries DROP CONSTRAINT inventory_entries_kind_check;
ALTER TABLE app.inventory_entries ADD CONSTRAINT inventory_entries_kind_check CHECK(kind IN ('correction','reversal','receipt','transfer','production_consumption','production_output','production_output_reversal','handling_unit_move','shipment'));
CREATE OR REPLACE FUNCTION app_private.prepare_inventory() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE supplier app.suppliers; dimension text; amount text; a jsonb; b jsonb;
BEGIN

 IF NEW.kind='shipment' THEN
  IF NEW.company_id IS DISTINCT FROM app.company_id() OR NOT app.session_active() OR EXISTS(SELECT 1 FROM app.revoked_sessions WHERE session_id=nullif(current_setting('app.session_id',true),'')::uuid) OR NOT app.allowed('shipments.read') OR NOT app.allowed('shipments.dispatch') OR NOT app.allowed('inventory.read') OR NOT app.allowed('inventory.reserve') THEN RAISE EXCEPTION 'Permission denied' USING ERRCODE='42501'; END IF;
  IF NEW.reverses_id IS NOT NULL OR NEW.production_order_id IS NOT NULL OR NEW.production_closure_id IS NOT NULL OR NOT EXISTS(SELECT 1 FROM app.shipments s WHERE s.company_id=NEW.company_id AND s.entry_id=NEW.id AND s.status='dispatched') THEN RAISE EXCEPTION 'Shipment document required' USING ERRCODE='42501'; END IF;
  NEW.actor_id:=app.actor_id();NEW.posted_at:=clock_timestamp();RETURN NEW;
 END IF;
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

REVOKE ALL ON FUNCTION app_private.command_shipment(),app_private.protect_shipment_reservation() FROM PUBLIC,anon,authenticated,app_runtime;
RESET ROLE;
COMMIT;
