-- Phase 12: production events only; no inventory effects or business fixtures.
BEGIN;
SET LOCAL ROLE app_owner;
INSERT INTO app.permissions VALUES ('production.record','Registrere gode emner'),('production.correct','Modregistrere fejlagtig produktion');
CREATE TABLE app.production_registrations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid NOT NULL,
 order_id uuid NOT NULL, idempotency_key uuid NOT NULL,
 kind text NOT NULL CHECK(kind IN ('record','reversal')),
 quantity numeric(20,8) NOT NULL CHECK(quantity>0 AND quantity<'Infinity'::numeric),
 boxes integer CHECK(boxes>=0), comment text NOT NULL DEFAULT '' CHECK(length(comment)<=2000),
 reverses_id uuid, snapshot jsonb NOT NULL DEFAULT '{}',
 created_by uuid NOT NULL DEFAULT app.actor_id() REFERENCES app.profiles(id),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(company_id,id), UNIQUE(company_id,idempotency_key), UNIQUE(company_id,reverses_id),
 FOREIGN KEY(company_id,order_id) REFERENCES app.production_orders(company_id,id),
 FOREIGN KEY(company_id,reverses_id) REFERENCES app.production_registrations(company_id,id),
 CHECK((kind='record' AND reverses_id IS NULL) OR (kind='reversal' AND reverses_id IS NOT NULL AND length(trim(comment))>0))
);
CREATE INDEX production_registrations_history ON app.production_registrations(company_id,order_id,created_at,id);
ALTER TABLE app.production_registrations ENABLE ROW LEVEL SECURITY;
CREATE POLICY read ON app.production_registrations FOR SELECT TO app_runtime USING(company_id=app.company_id() AND app.allowed('production.read'));
CREATE POLICY insert_registration ON app.production_registrations FOR INSERT TO app_runtime WITH CHECK(company_id=app.company_id() AND app.allowed('production.read') AND ((kind='record' AND app.allowed('production.record')) OR (kind='reversal' AND app.allowed('production.correct'))));
REVOKE ALL ON app.production_registrations FROM PUBLIC,anon,authenticated;
GRANT SELECT ON app.production_registrations TO app_runtime;
GRANT INSERT(company_id,order_id,idempotency_key,kind,quantity,boxes,comment,reverses_id) ON app.production_registrations TO app_runtime;
CREATE FUNCTION app_private.prepare_production_registration() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE o app.production_orders; original app.production_registrations; BEGIN
 IF NEW.company_id IS DISTINCT FROM app.company_id() OR app.actor_id() IS NULL OR NOT app.allowed('production.read') OR NOT app.allowed(CASE WHEN NEW.kind='reversal' THEN 'production.correct' ELSE 'production.record' END) THEN RAISE EXCEPTION 'Permission denied' USING ERRCODE='42501'; END IF;
 SELECT * INTO o FROM app.production_orders WHERE company_id=NEW.company_id AND id=NEW.order_id FOR UPDATE;
 IF o.id IS NULL OR o.status<>'in_production' THEN RAISE EXCEPTION 'Running order required' USING ERRCODE='23514'; END IF;
 IF NEW.kind='record' THEN
  IF length(trim(o.problem))>0 THEN RAISE EXCEPTION 'Resolve open problem first' USING ERRCODE='23514'; END IF;
  IF o.snapshot->'unit' IS NULL OR o.snapshot->'unit'='null'::jsonb THEN RAISE EXCEPTION 'Unit required' USING ERRCODE='23514'; END IF;
  IF o.snapshot->'unit'->>'dimension'='count' AND NEW.quantity<>trunc(NEW.quantity) THEN RAISE EXCEPTION 'Whole units required' USING ERRCODE='23514'; END IF;
  NEW.snapshot:=jsonb_build_object('order_id',o.id,'order_code',o.code,'order_version',o.version,'product',o.snapshot->'product','unit',o.snapshot->'unit','machine',o.snapshot->'machine','planned_quantity',o.quantity::text);
 ELSE
  SELECT * INTO original FROM app.production_registrations WHERE company_id=NEW.company_id AND order_id=NEW.order_id AND id=NEW.reverses_id AND kind='record';
  IF original.id IS NULL OR EXISTS(SELECT 1 FROM app.production_registrations WHERE company_id=NEW.company_id AND reverses_id=original.id) THEN RAISE EXCEPTION 'Unreversed registration required' USING ERRCODE='23514'; END IF;
  NEW.quantity:=original.quantity; NEW.boxes:=original.boxes; NEW.snapshot:=original.snapshot;
 END IF;
 NEW.created_by:=app.actor_id(); NEW.created_at:=clock_timestamp(); RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION app_private.prepare_production_registration() FROM PUBLIC,anon,authenticated,app_runtime;
CREATE TRIGGER production_registrations_prepare BEFORE INSERT ON app.production_registrations FOR EACH ROW EXECUTE FUNCTION app_private.prepare_production_registration();
CREATE FUNCTION app_private.immutable_production_registration() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$ BEGIN RAISE EXCEPTION 'Production history is immutable' USING ERRCODE='23514'; END $$;
REVOKE ALL ON FUNCTION app_private.immutable_production_registration() FROM PUBLIC,anon,authenticated,app_runtime;
CREATE TRIGGER production_registrations_immutable BEFORE UPDATE OR DELETE ON app.production_registrations FOR EACH ROW EXECUTE FUNCTION app_private.immutable_production_registration();
CREATE OR REPLACE FUNCTION app_private.prepare_production_order() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE p app.items; u app.units; c app.customers; m app.machines; b jsonb; k jsonb; o jsonb; line jsonb; seen uuid[]; BEGIN
 IF NEW.company_id IS DISTINCT FROM app.company_id() OR app.actor_id() IS NULL OR NOT app.allowed('production.read') OR NOT app.allowed('production.manage') OR NOT app.allowed('masterdata.read') THEN RAISE EXCEPTION 'Permission denied' USING ERRCODE='42501'; END IF;
 IF TG_OP='INSERT' THEN
  IF NEW.status<>'draft' OR NEW.version<>1 OR NEW.created_by IS DISTINCT FROM app.actor_id() THEN RAISE EXCEPTION 'Draft required' USING ERRCODE='23514'; END IF;
 ELSE
  IF NEW.id<>OLD.id OR NEW.company_id<>OLD.company_id OR NEW.product_id<>OLD.product_id OR NEW.idempotency_key<>OLD.idempotency_key OR NEW.request<>OLD.request OR NEW.created_at<>OLD.created_at OR NEW.created_by<>OLD.created_by OR NEW.version<>OLD.version+1 THEN RAISE EXCEPTION 'Immutable identity or stale version' USING ERRCODE='23514'; END IF;
  IF NEW.status<>OLD.status AND NOT ((OLD.status='draft' AND NEW.status='planned') OR (OLD.status='planned' AND NEW.status IN ('draft','ready')) OR (OLD.status='ready' AND NEW.status IN ('planned','in_production'))) THEN RAISE EXCEPTION 'Unsupported transition' USING ERRCODE='23514'; END IF;
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
 IF NEW.status='in_production' AND OLD.status IS DISTINCT FROM 'in_production' AND (NEW.machine_id IS NULL OR NEW.packing_revision_id IS NULL OR length(trim(NEW.problem))>0) THEN RAISE EXCEPTION 'Machine, packing and no open problem required to start' USING ERRCODE='23514'; END IF;
 IF NEW.status='ready' AND (TG_OP='INSERT' OR OLD.status<>'ready') AND (NEW.machine_id IS NULL OR NEW.packing_revision_id IS NULL OR length(trim(NEW.problem))>0) THEN RAISE EXCEPTION 'Machine, packing and no open problem required' USING ERRCODE='23514'; END IF;
 NEW.updated_at:=clock_timestamp(); RETURN NEW;
END $$;
RESET ROLE;
COMMIT;
