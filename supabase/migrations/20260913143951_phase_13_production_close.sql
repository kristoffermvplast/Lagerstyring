-- Phase 13: return attribution and atomic, reviewed production closure. No hosted fixtures.
BEGIN;
SET LOCAL ROLE app_owner;
INSERT INTO app.permissions VALUES ('production.return','Returnere udleveret materiale'),('production.close','Afstemme og afslutte produktion');
CREATE TABLE app.production_closures (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),company_id uuid NOT NULL,order_id uuid NOT NULL,
 idempotency_key uuid NOT NULL,review_token text NOT NULL CHECK(length(review_token)=32),
 rejected_quantity numeric(20,8) NOT NULL CHECK(rejected_quantity>=0 AND rejected_quantity<'Infinity'::numeric),
 comment text NOT NULL CHECK(length(trim(comment)) BETWEEN 3 AND 2000),
 snapshot jsonb NOT NULL DEFAULT '{}',created_by uuid NOT NULL DEFAULT app.actor_id() REFERENCES app.profiles(id),created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(company_id,id),UNIQUE(company_id,order_id),UNIQUE(company_id,idempotency_key),
 FOREIGN KEY(company_id,order_id) REFERENCES app.production_orders(company_id,id)
);
ALTER TABLE app.production_closures ENABLE ROW LEVEL SECURITY;
CREATE POLICY read ON app.production_closures FOR SELECT TO app_runtime USING(company_id=app.company_id() AND app.allowed('production.read'));
CREATE POLICY insert_closure ON app.production_closures FOR INSERT TO app_runtime WITH CHECK(company_id=app.company_id() AND app.allowed('production.read') AND app.allowed('production.close') AND app.allowed('production.manage') AND app.allowed('masterdata.read') AND app.allowed('inventory.read'));
REVOKE ALL ON app.production_closures FROM PUBLIC,anon,authenticated;
GRANT SELECT ON app.production_closures TO app_runtime;
GRANT INSERT(company_id,order_id,idempotency_key,review_token,rejected_quantity,comment) ON app.production_closures TO app_runtime;
CREATE TRIGGER production_closures_immutable BEFORE UPDATE OR DELETE ON app.production_closures FOR EACH ROW EXECUTE FUNCTION app_private.immutable_production_registration();
ALTER TABLE app.inventory_entries ADD COLUMN production_return_of uuid,
 ADD COLUMN production_closure_id uuid,
 ADD CONSTRAINT production_return_fk FOREIGN KEY(company_id,production_return_of) REFERENCES app.inventory_entries(company_id,id),
 ADD CONSTRAINT production_closure_fk FOREIGN KEY(company_id,production_closure_id) REFERENCES app.production_closures(company_id,id),
 ADD CONSTRAINT production_return_kind CHECK(production_return_of IS NULL OR (production_order_id IS NOT NULL AND kind IN ('transfer','reversal'))),
 ADD CONSTRAINT production_consumption_closure CHECK((kind='production_consumption')=(production_closure_id IS NOT NULL));
ALTER TABLE app.inventory_entries DROP CONSTRAINT inventory_entries_kind_check;
ALTER TABLE app.inventory_entries ADD CONSTRAINT inventory_entries_kind_check CHECK(kind IN ('correction','reversal','receipt','transfer','production_consumption'));
ALTER TABLE app.inventory_entries DROP CONSTRAINT inventory_production_kind;
ALTER TABLE app.inventory_entries ADD CONSTRAINT inventory_production_kind CHECK(production_order_id IS NULL OR kind IN ('transfer','reversal','production_consumption'));
CREATE INDEX production_returns_original ON app.inventory_entries(company_id,production_return_of) WHERE production_return_of IS NOT NULL;
CREATE UNIQUE INDEX production_consumption_once ON app.inventory_entries(company_id,production_closure_id) WHERE production_closure_id IS NOT NULL;
GRANT INSERT(production_return_of) ON app.inventory_entries TO app_runtime;
-- No runtime INSERT privilege for closure id or consumption. Only the closure trigger can post it.
CREATE FUNCTION app.production_material_state(c uuid,o uuid) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path=pg_catalog AS $$
DECLARE result jsonb;
BEGIN
 IF c IS DISTINCT FROM app.company_id() OR NOT app.allowed('production.read') OR NOT app.allowed('inventory.read') THEN RAISE EXCEPTION 'Permission denied' USING ERRCODE='42501'; END IF;
 SELECT coalesce(jsonb_agg(to_jsonb(q) ORDER BY q.issue_id),'[]'::jsonb) INTO result FROM (
 SELECT e.id issue_id,l.item_id,l.owner_id,l.location_id,l.unit_id,l.snapshot,e.production_snapshot,l.quantity::text issued_quantity,
 coalesce(r.returned,0)::text returned_quantity,(l.quantity-coalesce(r.returned,0))::text remaining_quantity
 FROM app.inventory_entries e JOIN app.inventory_lines l ON l.company_id=e.company_id AND l.entry_id=e.id AND l.quantity>0
 LEFT JOIN LATERAL(SELECT sum(rl.quantity) returned FROM app.inventory_entries re JOIN app.inventory_lines rl ON rl.company_id=re.company_id AND rl.entry_id=re.id AND rl.quantity>0 WHERE re.company_id=e.company_id AND re.production_return_of=e.id AND re.kind='transfer' AND NOT EXISTS(SELECT 1 FROM app.inventory_entries rv WHERE rv.company_id=re.company_id AND rv.reverses_id=re.id)) r ON true
 WHERE e.company_id=c AND e.production_order_id=o AND e.kind='transfer' AND e.production_return_of IS NULL
 AND NOT EXISTS(SELECT 1 FROM app.inventory_entries rv WHERE rv.company_id=e.company_id AND rv.reverses_id=e.id)
 ) q;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION app.production_material_state(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION app.production_material_state(uuid,uuid) TO app_runtime;
CREATE FUNCTION app.production_close_review(c uuid,o uuid) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path=pg_catalog AS $$
DECLARE ord app.production_orders; good text; state jsonb; review jsonb;
BEGIN
 IF c IS DISTINCT FROM app.company_id() OR NOT app.allowed('production.read') OR NOT app.allowed('inventory.read') THEN RAISE EXCEPTION 'Permission denied' USING ERRCODE='42501'; END IF;
 SELECT * INTO ord FROM app.production_orders WHERE company_id=c AND id=o;
 IF ord.id IS NULL THEN RETURN NULL; END IF;
 SELECT coalesce(sum(CASE WHEN kind='record' THEN quantity ELSE -quantity END),0)::text INTO good FROM app.production_registrations WHERE company_id=c AND order_id=o;
 state:=app.production_material_state(c,o);
 review:=jsonb_build_object('company_id',c,'order_id',o,'order_version',ord.version,'status',ord.status,'good_quantity',good,'planned_quantity',ord.quantity::text,'order_snapshot',ord.snapshot,'materials',state);
 RETURN review||jsonb_build_object('review_token',md5(review::text));
END $$;
REVOKE ALL ON FUNCTION app.production_close_review(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION app.production_close_review(uuid,uuid) TO app_runtime;
CREATE OR REPLACE FUNCTION app_private.prepare_production_order() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE p app.items; u app.units; c app.customers; m app.machines; b jsonb; k jsonb; o jsonb; line jsonb; seen uuid[]; BEGIN
 IF NEW.company_id IS DISTINCT FROM app.company_id() OR app.actor_id() IS NULL OR NOT app.allowed('production.read') OR NOT app.allowed('production.manage') OR NOT app.allowed('masterdata.read') THEN RAISE EXCEPTION 'Permission denied' USING ERRCODE='42501'; END IF;
 IF TG_OP='INSERT' THEN
  IF NEW.status<>'draft' OR NEW.version<>1 OR NEW.created_by IS DISTINCT FROM app.actor_id() THEN RAISE EXCEPTION 'Draft required' USING ERRCODE='23514'; END IF;
 ELSE
  IF OLD.status='completed' THEN RAISE EXCEPTION 'Completed order is immutable' USING ERRCODE='23514'; END IF;
  IF (NEW.status='reconciliation' OR OLD.status='reconciliation') AND NOT app.allowed('production.close') THEN RAISE EXCEPTION 'Close permission required' USING ERRCODE='42501'; END IF;
  IF NEW.status='completed' AND NOT EXISTS(SELECT 1 FROM app.production_closures WHERE company_id=NEW.company_id AND order_id=NEW.id) THEN RAISE EXCEPTION 'Closure document required' USING ERRCODE='23514'; END IF;
  IF NEW.id<>OLD.id OR NEW.company_id<>OLD.company_id OR NEW.product_id<>OLD.product_id OR NEW.idempotency_key<>OLD.idempotency_key OR NEW.request<>OLD.request OR NEW.created_at<>OLD.created_at OR NEW.created_by<>OLD.created_by OR NEW.version<>OLD.version+1 THEN RAISE EXCEPTION 'Immutable identity or stale version' USING ERRCODE='23514'; END IF;
  IF NEW.status<>OLD.status AND NOT ((OLD.status='draft' AND NEW.status='planned') OR (OLD.status='planned' AND NEW.status IN ('draft','ready')) OR (OLD.status='ready' AND NEW.status IN ('planned','in_production')) OR (OLD.status='in_production' AND NEW.status='reconciliation') OR (OLD.status='reconciliation' AND NEW.status IN ('in_production','completed'))) THEN RAISE EXCEPTION 'Unsupported transition' USING ERRCODE='23514'; END IF;
  IF OLD.status<>'draft' AND (to_jsonb(NEW)-ARRAY['status','problem','version','updated_at'])<>(to_jsonb(OLD)-ARRAY['status','problem','version','updated_at']) THEN RAISE EXCEPTION 'Return to draft before editing' USING ERRCODE='23514'; END IF;
  IF OLD.status<>'draft' THEN NEW.snapshot:=OLD.snapshot; END IF;
 END IF;
 -- Refresh draft snapshots on deliberate edits or planning, never on a read or masterdata update.
 IF TG_OP='INSERT' OR OLD.status='draft' THEN
  SELECT * INTO p FROM app.items WHERE company_id=NEW.company_id AND id=NEW.product_id AND kind='product' AND active FOR SHARE;
  IF p.id IS NULL THEN RAISE EXCEPTION 'Active product required' USING ERRCODE='23514'; END IF;
  SELECT * INTO u FROM app.units WHERE company_id=NEW.company_id AND id=p.unit_id AND active FOR SHARE;
  IF p.unit_id IS NOT NULL AND u.id IS NULL THEN RAISE EXCEPTION 'Active unit required' USING ERRCODE='23514'; END IF;
  IF u.dimension='count' AND NEW.quantity<>trunc(NEW.quantity) THEN RAISE EXCEPTION 'Whole units required' USING ERRCODE='23514'; END IF;
  IF NEW.customer_id IS NOT NULL THEN
   SELECT * INTO c FROM app.customers WHERE company_id=NEW.company_id AND id=NEW.customer_id AND active FOR SHARE;
   IF c.id IS NULL THEN RAISE EXCEPTION 'Active customer required' USING ERRCODE='23514'; END IF;
  END IF;
  IF NEW.machine_id IS NOT NULL THEN
   SELECT * INTO m FROM app.machines WHERE company_id=NEW.company_id AND id=NEW.machine_id AND active FOR SHARE;
   IF m.id IS NULL THEN RAISE EXCEPTION 'Active machine required' USING ERRCODE='23514'; END IF;
  END IF;
  SELECT to_jsonb(v)||jsonb_build_object('base_quantity',v.base_quantity::text,'lines',(SELECT jsonb_agg(to_jsonb(l)||jsonb_build_object('quantity',l.quantity::text) ORDER BY level,kind,id) FROM app.recipe_lines l WHERE l.company_id=v.company_id AND l.revision_id=v.id)) INTO b
   FROM app.recipe_revisions v JOIN app.recipes r ON r.company_id=v.company_id AND r.id=v.recipe_id
   WHERE v.company_id=NEW.company_id AND v.id=NEW.bom_revision_id AND v.sealed AND r.active AND r.kind='bom' AND r.product_id=NEW.product_id;
  SELECT to_jsonb(v)||jsonb_build_object('base_quantity',v.base_quantity::text,'lines',(SELECT jsonb_agg(to_jsonb(l)||jsonb_build_object('quantity',l.quantity::text) ORDER BY level,kind,id) FROM app.recipe_lines l WHERE l.company_id=v.company_id AND l.revision_id=v.id)) INTO k
   FROM app.recipe_revisions v JOIN app.recipes r ON r.company_id=v.company_id AND r.id=v.recipe_id
   WHERE v.company_id=NEW.company_id AND v.id=NEW.packing_revision_id AND v.sealed AND r.active AND r.kind='packing' AND r.product_id=NEW.product_id;
  IF (NEW.bom_revision_id IS NOT NULL AND b IS NULL) OR (NEW.packing_revision_id IS NOT NULL AND k IS NULL) OR (b IS NOT NULL AND (b->'snapshot'->>'unit_id') IS DISTINCT FROM u.id::text) OR (k IS NOT NULL AND (k->'snapshot'->>'unit_id') IS DISTINCT FROM u.id::text) THEN RAISE EXCEPTION 'Compatible sealed revision required' USING ERRCODE='23514'; END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(b->'lines') x JOIN jsonb_array_elements(k->'lines') y ON x->>'component_id'=y->>'component_id') THEN RAISE EXCEPTION 'Duplicate consumption owner' USING ERRCODE='23514'; END IF;
  seen:=ARRAY[]::uuid[];
  FOR o IN SELECT * FROM jsonb_array_elements(NEW.packing_overrides) LOOP
   IF jsonb_typeof(o)<>'object' OR NOT(o ? 'component_id' AND o ? 'quantity') OR (o-ARRAY['component_id','quantity'])<>'{}'::jsonb OR jsonb_typeof(o->'quantity')<>'string' OR (o->>'quantity') !~ '^(0|[1-9][0-9]{0,11})(\.[0-9]{1,8})?$' THEN RAISE EXCEPTION 'Invalid packing override' USING ERRCODE='23514'; END IF;
   SELECT x INTO line FROM jsonb_array_elements(k->'lines') x WHERE x->>'component_id'=o->>'component_id';
   IF line IS NULL OR (o->>'component_id')::uuid=ANY(seen) OR (o->>'quantity')::numeric<=0 OR (((line->>'kind')='accessory' OR (line->>'level')::int>0 OR u.dimension='count') AND (o->>'quantity')::numeric<>trunc((o->>'quantity')::numeric)) THEN RAISE EXCEPTION 'Invalid packing quantity or reference' USING ERRCODE='23514'; END IF;
   seen:=array_append(seen,(o->>'component_id')::uuid);
   k:=jsonb_set(k,'{lines}',(SELECT jsonb_agg(CASE WHEN x->>'component_id'=o->>'component_id' THEN x||jsonb_build_object('quantity',o->>'quantity') ELSE x END ORDER BY (x->>'level')::int,x->>'kind',x->>'id') FROM jsonb_array_elements(k->'lines') x));
  END LOOP;
  NEW.snapshot:=jsonb_build_object('product',jsonb_build_object('id',p.id,'code',p.code,'name',p.name,'production_notes',p.production_notes,'cycle_time_seconds',p.cycle_time_seconds::text,'cavities',p.cavities),'unit',CASE WHEN u.id IS NULL THEN NULL ELSE jsonb_build_object('id',u.id,'symbol',u.symbol,'dimension',u.dimension) END,'customer',CASE WHEN c.id IS NULL THEN NULL ELSE jsonb_build_object('id',c.id,'code',c.code,'name',c.name,'address',c.address) END,'machine',CASE WHEN m.id IS NULL THEN NULL ELSE jsonb_build_object('id',m.id,'code',m.code,'name',m.name) END,'bom',b,'packing',k);
 END IF;
 IF TG_OP='UPDATE' AND NEW.status<>OLD.status AND NEW.status IN ('planned','ready','in_production') THEN
  IF NOT EXISTS(SELECT 1 FROM app.items WHERE company_id=NEW.company_id AND id=NEW.product_id AND active) OR
   (NEW.machine_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM app.machines WHERE company_id=NEW.company_id AND id=NEW.machine_id AND active)) OR
   EXISTS(SELECT 1 FROM app.recipe_lines l JOIN app.items i ON i.company_id=l.company_id AND i.id=l.component_id LEFT JOIN app.units current_unit ON current_unit.company_id=i.company_id AND current_unit.id=i.unit_id WHERE l.company_id=NEW.company_id AND l.revision_id IN (NEW.bom_revision_id,NEW.packing_revision_id) AND (NOT i.active OR current_unit.id IS NULL OR NOT current_unit.active)) THEN RAISE EXCEPTION 'Inactive production reference' USING ERRCODE='23514'; END IF;
 END IF;
 IF NEW.status IN ('planned','ready','in_production') AND (NEW.bom_revision_id IS NULL OR NEW.snapshot->'unit'='null'::jsonb) THEN RAISE EXCEPTION 'BOM and unit required to plan' USING ERRCODE='23514'; END IF;
 IF NEW.status='in_production' AND OLD.status='ready' AND (NEW.machine_id IS NULL OR NEW.packing_revision_id IS NULL OR length(trim(NEW.problem))>0) THEN RAISE EXCEPTION 'Machine, packing and no open problem required to start' USING ERRCODE='23514'; END IF;
 IF NEW.status='ready' AND (TG_OP='INSERT' OR OLD.status<>'ready') AND (NEW.machine_id IS NULL OR NEW.packing_revision_id IS NULL OR length(trim(NEW.problem))>0) THEN RAISE EXCEPTION 'Machine, packing and no open problem required' USING ERRCODE='23514'; END IF;
 NEW.updated_at:=clock_timestamp(); RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION app_private.prepare_inventory() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE supplier app.suppliers; dimension text; amount text; a jsonb; b jsonb;
BEGIN
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

CREATE OR REPLACE FUNCTION app_private.guard_production_issue() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE ord app.production_orders; original app.inventory_entries; issue app.inventory_entries; machine app.machines; component jsonb; item app.items; source app.inventory_lines; remaining numeric;
BEGIN
 IF NEW.kind='reversal' THEN
  SELECT * INTO original FROM app.inventory_entries WHERE company_id=NEW.company_id AND id=NEW.reverses_id;
  IF NEW.production_order_id IS NOT NULL AND NEW.production_order_id IS DISTINCT FROM original.production_order_id THEN RAISE EXCEPTION 'Invalid production reference' USING ERRCODE='23514'; END IF;
  NEW.production_order_id:=original.production_order_id; NEW.production_return_of:=original.production_return_of;
 END IF;
 NEW.production_snapshot:=NULL;
 IF NEW.production_order_id IS NULL THEN RETURN NEW; END IF;
 IF NEW.company_id IS DISTINCT FROM app.company_id() OR NOT app.session_active() OR NOT app.allowed('production.read') OR NOT app.allowed('inventory.read') OR NOT app.allowed(CASE WHEN NEW.kind='production_consumption' THEN 'production.close' WHEN NEW.production_return_of IS NOT NULL THEN 'production.return' ELSE 'production.issue' END) OR (NEW.kind<>'production_consumption' AND NOT app.allowed('inventory.transfer')) THEN RAISE EXCEPTION 'Permission denied' USING ERRCODE='42501'; END IF;
 SELECT * INTO ord FROM app.production_orders WHERE company_id=NEW.company_id AND id=NEW.production_order_id FOR UPDATE;
 IF ord.id IS NULL OR ord.status NOT IN ('planned','ready','in_production','reconciliation') THEN RAISE EXCEPTION 'Open production order required' USING ERRCODE='23514'; END IF;
 IF NEW.kind='production_consumption' THEN
  IF ord.status<>'reconciliation' THEN RAISE EXCEPTION 'Reconciliation required' USING ERRCODE='23514'; END IF;
  NEW.production_snapshot:=ord.snapshot; RETURN NEW;
 END IF;
 IF NEW.kind='reversal' THEN
  IF original.production_return_of IS NULL AND EXISTS(SELECT 1 FROM app.inventory_entries e WHERE e.company_id=NEW.company_id AND e.production_return_of=original.id AND e.kind='transfer' AND NOT EXISTS(SELECT 1 FROM app.inventory_entries r WHERE r.company_id=e.company_id AND r.reverses_id=e.id)) THEN RAISE EXCEPTION 'Reverse returns before reversing issue' USING ERRCODE='23514'; END IF;
  NEW.production_snapshot:=original.production_snapshot; RETURN NEW;
 END IF;
 IF NEW.production_return_of IS NOT NULL THEN
  SELECT * INTO issue FROM app.inventory_entries WHERE company_id=NEW.company_id AND production_order_id=ord.id AND id=NEW.production_return_of AND kind='transfer' AND production_return_of IS NULL;
  IF issue.id IS NULL OR EXISTS(SELECT 1 FROM app.inventory_entries WHERE company_id=NEW.company_id AND reverses_id=issue.id) THEN RAISE EXCEPTION 'Unreversed issue required' USING ERRCODE='23514'; END IF;
  SELECT * INTO source FROM app.inventory_lines WHERE company_id=NEW.company_id AND entry_id=issue.id AND quantity>0;
  IF NEW.kind<>'transfer' OR (NEW.request->0->>'location_id')::uuid IS DISTINCT FROM source.location_id OR (NEW.request->0->>'owner_id')::uuid IS DISTINCT FROM source.owner_id OR (NEW.request->0->>'item_id')::uuid IS DISTINCT FROM source.item_id THEN RAISE EXCEPTION 'Return must use issued stock and owner' USING ERRCODE='23514'; END IF;
  SELECT (s->>'remaining_quantity')::numeric INTO remaining FROM jsonb_array_elements(app.production_material_state(NEW.company_id,ord.id)) s WHERE s->>'issue_id'=issue.id::text;
  IF remaining IS NULL OR (NEW.request->1->>'quantity')::numeric>remaining THEN RAISE EXCEPTION 'Return exceeds outstanding issue' USING ERRCODE='23514'; END IF;
  NEW.production_snapshot:=issue.production_snapshot; RETURN NEW;
 END IF;
 IF NEW.kind<>'transfer' OR ord.status='reconciliation' OR length(trim(ord.problem))>0 THEN RAISE EXCEPTION 'Production issue blocked' USING ERRCODE='23514'; END IF;
 SELECT * INTO machine FROM app.machines WHERE company_id=NEW.company_id AND id=ord.machine_id FOR SHARE;
 IF machine.id IS NULL OR NOT machine.active THEN RAISE EXCEPTION 'Active order machine required' USING ERRCODE='23514'; END IF;
 IF machine.location_id IS NOT NULL AND machine.location_id IS DISTINCT FROM (NEW.request->1->>'location_id')::uuid THEN RAISE EXCEPTION 'Use the order machine location' USING ERRCODE='23514'; END IF;
 SELECT x INTO component FROM jsonb_array_elements(coalesce(nullif(ord.snapshot->'bom'->'lines','null'::jsonb),'[]'::jsonb)||coalesce(nullif(ord.snapshot->'packing'->'lines','null'::jsonb),'[]'::jsonb)) x WHERE x->>'component_id'=NEW.request->0->>'item_id' LIMIT 1;
 SELECT * INTO item FROM app.items WHERE company_id=NEW.company_id AND id=(NEW.request->0->>'item_id')::uuid FOR SHARE;
 IF component IS NULL OR item.id IS NULL OR NOT item.active OR item.unit_id::text IS DISTINCT FROM component->'snapshot'->>'unit_id' THEN RAISE EXCEPTION 'Active component with snapshot unit required' USING ERRCODE='23514'; END IF;
 NEW.production_snapshot:=jsonb_build_object('order_id',ord.id,'order_code',ord.code,'order_version',ord.version,'machine',jsonb_build_object('id',machine.id,'code',machine.code,'name',machine.name),'component',component->'snapshot');
 RETURN NEW;
END $$;
CREATE FUNCTION app_private.prepare_production_closure() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE ord app.production_orders; review jsonb; consumption jsonb;
BEGIN
 IF NEW.company_id IS DISTINCT FROM app.company_id() OR app.actor_id() IS NULL OR NOT app.allowed('production.read') OR NOT app.allowed('production.close') OR NOT app.allowed('production.manage') OR NOT app.allowed('masterdata.read') OR NOT app.allowed('inventory.read') THEN RAISE EXCEPTION 'Permission denied' USING ERRCODE='42501'; END IF;
 SELECT * INTO ord FROM app.production_orders WHERE company_id=NEW.company_id AND id=NEW.order_id FOR UPDATE;
 IF ord.id IS NULL OR ord.status<>'reconciliation' OR length(trim(ord.problem))>0 THEN RAISE EXCEPTION 'Reconciled order without problem required' USING ERRCODE='23514'; END IF;
 review:=app.production_close_review(NEW.company_id,NEW.order_id);
 IF review->>'review_token' IS DISTINCT FROM NEW.review_token THEN RAISE EXCEPTION 'Review changed; reload before confirming' USING ERRCODE='23514'; END IF;
 IF ord.snapshot->'unit'->>'dimension'='count' AND NEW.rejected_quantity<>trunc(NEW.rejected_quantity) THEN RAISE EXCEPTION 'Whole rejected units required' USING ERRCODE='23514'; END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('item_id',item,'owner_id',owner,'location_id',location,'quantity',(-quantity)::text) ORDER BY item,owner,location),'[]'::jsonb) INTO consumption FROM (
 SELECT s->>'item_id' item,s->>'owner_id' owner,s->>'location_id' location,sum((s->>'remaining_quantity')::numeric) quantity FROM jsonb_array_elements(review->'materials') s GROUP BY 1,2,3 HAVING sum((s->>'remaining_quantity')::numeric)>0) q;
 IF jsonb_array_length(consumption)>100 THEN RAISE EXCEPTION 'At most 100 consumption dimensions per closure' USING ERRCODE='23514'; END IF;
 NEW.snapshot:=review||jsonb_build_object('consumption',consumption,'rejected_quantity',NEW.rejected_quantity::text);
 NEW.created_by:=app.actor_id();NEW.created_at:=clock_timestamp();RETURN NEW;
END $$;
CREATE TRIGGER production_closures_prepare BEFORE INSERT ON app.production_closures FOR EACH ROW EXECUTE FUNCTION app_private.prepare_production_closure();
CREATE FUNCTION app_private.post_production_closure() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 -- Exact net issued minus returns is consumed once, never labelled physical waste.
 IF jsonb_array_length(NEW.snapshot->'consumption')>0 THEN
  INSERT INTO app.inventory_entries(company_id,idempotency_key,kind,reason,request,production_order_id,production_closure_id)
  VALUES(NEW.company_id,NEW.id,'production_consumption','Afstemt nettomaterialeforbrug',NEW.snapshot->'consumption',NEW.order_id,NEW.id);
 END IF;
 UPDATE app.production_orders SET status='completed',version=version+1 WHERE company_id=NEW.company_id AND id=NEW.order_id;
 RETURN NEW;
END $$;
CREATE TRIGGER production_closures_post AFTER INSERT ON app.production_closures FOR EACH ROW EXECUTE FUNCTION app_private.post_production_closure();
REVOKE ALL ON FUNCTION app_private.prepare_production_closure(),app_private.post_production_closure() FROM PUBLIC,anon,authenticated,app_runtime;
RESET ROLE;
COMMIT;
