-- Phase 10: planning documents only. No inventory writes or hosted fixtures.
BEGIN;
SET LOCAL ROLE app_owner;
INSERT INTO app.permissions VALUES ('production.read','Se produktionsordrer og behov'),('production.manage','Oprette og planlægge produktionsordrer');
CREATE TABLE app.production_orders (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid NOT NULL REFERENCES app.companies(id),
 code text NOT NULL CHECK(length(trim(code)) BETWEEN 1 AND 60 AND code=trim(code)),
 product_id uuid NOT NULL, customer_id uuid, machine_id uuid,
 quantity numeric(20,8) NOT NULL CHECK(quantity>0 AND quantity<'Infinity'::numeric),
 bom_revision_id uuid, packing_revision_id uuid,
 packing_overrides jsonb NOT NULL DEFAULT '[]' CHECK(jsonb_typeof(packing_overrides)='array' AND jsonb_array_length(packing_overrides)<=100),
 status text NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','planned','ready','in_production','reconciliation','completed')),
 problem text NOT NULL DEFAULT '' CHECK(length(problem)<=1000),
 planned_start timestamptz, deadline timestamptz,
 priority integer NOT NULL DEFAULT 0 CHECK(priority BETWEEN 0 AND 3), notes text NOT NULL DEFAULT '' CHECK(length(notes)<=4000),
 version integer NOT NULL DEFAULT 1 CHECK(version>0),
 snapshot jsonb NOT NULL DEFAULT '{}',
 idempotency_key uuid NOT NULL, request jsonb NOT NULL,
 created_by uuid NOT NULL DEFAULT app.actor_id() REFERENCES app.profiles(id),
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(company_id,id), UNIQUE(company_id,idempotency_key),
 FOREIGN KEY(company_id,product_id) REFERENCES app.items(company_id,id),
 FOREIGN KEY(company_id,customer_id) REFERENCES app.customers(company_id,id),
 FOREIGN KEY(company_id,machine_id) REFERENCES app.machines(company_id,id),
 FOREIGN KEY(company_id,bom_revision_id) REFERENCES app.recipe_revisions(company_id,id),
 FOREIGN KEY(company_id,packing_revision_id) REFERENCES app.recipe_revisions(company_id,id),
 CHECK(deadline IS NULL OR planned_start IS NULL OR deadline>=planned_start)
);
CREATE UNIQUE INDEX production_orders_code ON app.production_orders(company_id,lower(code));
CREATE INDEX production_orders_list ON app.production_orders(company_id,status,planned_start,id);
CREATE INDEX production_orders_product ON app.production_orders(company_id,product_id);
CREATE INDEX production_orders_customer ON app.production_orders(company_id,customer_id);
CREATE INDEX production_orders_machine ON app.production_orders(company_id,machine_id,planned_start);
CREATE INDEX production_orders_bom ON app.production_orders(company_id,bom_revision_id);
CREATE INDEX production_orders_packing ON app.production_orders(company_id,packing_revision_id);
CREATE TABLE app.production_order_audit (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),company_id uuid NOT NULL,order_id uuid NOT NULL,
 actor_id uuid NOT NULL REFERENCES app.profiles(id),occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 action text NOT NULL CHECK(action IN ('INSERT','UPDATE')),before_value jsonb,after_value jsonb NOT NULL,
 FOREIGN KEY(company_id,order_id) REFERENCES app.production_orders(company_id,id)
);
CREATE INDEX production_order_audit_history ON app.production_order_audit(company_id,order_id,occurred_at,id);
ALTER TABLE app.production_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.production_order_audit ENABLE ROW LEVEL SECURITY;
CREATE POLICY read ON app.production_orders FOR SELECT TO app_runtime USING(company_id=app.company_id() AND app.allowed('production.read'));
CREATE POLICY read ON app.production_order_audit FOR SELECT TO app_runtime USING(company_id=app.company_id() AND app.allowed('production.read'));
CREATE POLICY insert_order ON app.production_orders FOR INSERT TO app_runtime WITH CHECK(company_id=app.company_id() AND app.allowed('production.read') AND app.allowed('production.manage') AND app.allowed('masterdata.read'));
CREATE POLICY update_order ON app.production_orders FOR UPDATE TO app_runtime USING(company_id=app.company_id() AND app.allowed('production.read') AND app.allowed('production.manage') AND app.allowed('masterdata.read')) WITH CHECK(company_id=app.company_id() AND app.allowed('production.read') AND app.allowed('production.manage') AND app.allowed('masterdata.read'));
GRANT SELECT ON app.production_orders,app.production_order_audit TO app_runtime;
GRANT INSERT(company_id,code,product_id,customer_id,machine_id,quantity,bom_revision_id,packing_revision_id,packing_overrides,planned_start,deadline,priority,notes,idempotency_key,request) ON app.production_orders TO app_runtime;
GRANT UPDATE(code,customer_id,machine_id,quantity,bom_revision_id,packing_revision_id,packing_overrides,planned_start,deadline,priority,notes,problem,status,version) ON app.production_orders TO app_runtime;
-- Internal trigger only, owned by NOLOGIN app_owner. Explicit tenant/permission checks
-- before privileged snapshot reads; no EXECUTE grant and no browser schema access.
CREATE FUNCTION app_private.prepare_production_order() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE p app.items; u app.units; c app.customers; m app.machines; b jsonb; k jsonb; o jsonb; line jsonb; seen uuid[]; BEGIN
 IF NEW.company_id IS DISTINCT FROM app.company_id() OR app.actor_id() IS NULL OR NOT app.allowed('production.read') OR NOT app.allowed('production.manage') OR NOT app.allowed('masterdata.read') THEN RAISE EXCEPTION 'Permission denied' USING ERRCODE='42501'; END IF;
 IF TG_OP='INSERT' THEN
  IF NEW.status<>'draft' OR NEW.version<>1 OR NEW.created_by IS DISTINCT FROM app.actor_id() THEN RAISE EXCEPTION 'Draft required' USING ERRCODE='23514'; END IF;
 ELSE
  IF NEW.id<>OLD.id OR NEW.company_id<>OLD.company_id OR NEW.product_id<>OLD.product_id OR NEW.idempotency_key<>OLD.idempotency_key OR NEW.request<>OLD.request OR NEW.created_at<>OLD.created_at OR NEW.created_by<>OLD.created_by OR NEW.version<>OLD.version+1 THEN RAISE EXCEPTION 'Immutable identity or stale version' USING ERRCODE='23514'; END IF;
  IF NEW.status<>OLD.status AND NOT ((OLD.status='draft' AND NEW.status='planned') OR (OLD.status='planned' AND NEW.status IN ('draft','ready')) OR (OLD.status='ready' AND NEW.status='planned')) THEN RAISE EXCEPTION 'Unsupported transition' USING ERRCODE='23514'; END IF;
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
 IF TG_OP='UPDATE' AND NEW.status<>OLD.status AND NEW.status IN ('planned','ready') THEN
  IF NOT EXISTS(SELECT 1 FROM app.items WHERE company_id=NEW.company_id AND id=NEW.product_id AND active) OR
   (NEW.machine_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM app.machines WHERE company_id=NEW.company_id AND id=NEW.machine_id AND active)) OR
   EXISTS(SELECT 1 FROM app.recipe_lines l JOIN app.items i ON i.company_id=l.company_id AND i.id=l.component_id LEFT JOIN app.units current_unit ON current_unit.company_id=i.company_id AND current_unit.id=i.unit_id WHERE l.company_id=NEW.company_id AND l.revision_id IN (NEW.bom_revision_id,NEW.packing_revision_id) AND (NOT i.active OR current_unit.id IS NULL OR NOT current_unit.active)) THEN RAISE EXCEPTION 'Inactive production reference' USING ERRCODE='23514'; END IF;
 END IF;
 IF NEW.status IN ('planned','ready') AND (NEW.bom_revision_id IS NULL OR NEW.snapshot->'unit'='null'::jsonb) THEN RAISE EXCEPTION 'BOM and unit required to plan' USING ERRCODE='23514'; END IF;
 IF NEW.status='ready' AND (TG_OP='INSERT' OR OLD.status<>'ready') AND (NEW.machine_id IS NULL OR NEW.packing_revision_id IS NULL OR length(trim(NEW.problem))>0) THEN RAISE EXCEPTION 'Machine, packing and no open problem required' USING ERRCODE='23514'; END IF;
 NEW.updated_at:=clock_timestamp(); RETURN NEW;
END $$;
CREATE TRIGGER production_orders_prepare BEFORE INSERT OR UPDATE ON app.production_orders FOR EACH ROW EXECUTE FUNCTION app_private.prepare_production_order();
CREATE FUNCTION app_private.audit_production_order() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ BEGIN
 IF app.actor_id() IS NULL OR NEW.company_id IS DISTINCT FROM app.company_id() OR NOT app.allowed('production.manage') THEN RAISE EXCEPTION 'Permission denied' USING ERRCODE='42501'; END IF;
 INSERT INTO app.production_order_audit(company_id,order_id,actor_id,action,before_value,after_value) VALUES(NEW.company_id,NEW.id,app.actor_id(),TG_OP,CASE WHEN TG_OP='UPDATE' THEN to_jsonb(OLD)-'request' ELSE NULL END,to_jsonb(NEW)-'request'); RETURN NULL;
END $$;
CREATE TRIGGER production_orders_audit AFTER INSERT OR UPDATE ON app.production_orders FOR EACH ROW EXECUTE FUNCTION app_private.audit_production_order();
RESET ROLE;
COMMIT;
