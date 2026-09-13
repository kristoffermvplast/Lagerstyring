-- Material issue is a transfer, never consumption. Existing journal owns balances.
BEGIN;
SET LOCAL ROLE app_owner;
INSERT INTO app.permissions VALUES ('production.issue','Sende materiale til produktion');
ALTER TABLE app.inventory_entries ADD COLUMN production_order_id uuid,
 ADD COLUMN production_snapshot jsonb,
 ADD CONSTRAINT inventory_production_order_fk FOREIGN KEY(company_id,production_order_id) REFERENCES app.production_orders(company_id,id),
 ADD CONSTRAINT inventory_production_kind CHECK(production_order_id IS NULL OR kind IN ('transfer','reversal')),
 ADD CONSTRAINT inventory_production_snapshot CHECK((production_order_id IS NULL)=(production_snapshot IS NULL));
CREATE INDEX inventory_production_order ON app.inventory_entries(company_id,production_order_id,posted_at DESC,id) WHERE production_order_id IS NOT NULL;
GRANT INSERT(production_order_id) ON app.inventory_entries TO app_runtime;
-- Internal guards retain the existing ownership pattern, fixed search path and no public EXECUTE.
CREATE FUNCTION app_private.guard_production_issue() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE ord app.production_orders; original app.inventory_entries; machine app.machines; component jsonb; item app.items;
BEGIN
 IF NEW.kind='reversal' THEN
  SELECT * INTO original FROM app.inventory_entries WHERE company_id=NEW.company_id AND id=NEW.reverses_id;
  IF NEW.production_order_id IS NOT NULL AND NEW.production_order_id IS DISTINCT FROM original.production_order_id THEN RAISE EXCEPTION 'Invalid production reference' USING ERRCODE='23514'; END IF;
  NEW.production_order_id:=original.production_order_id;
 END IF;
 NEW.production_snapshot:=NULL;
 IF NEW.production_order_id IS NULL THEN RETURN NEW; END IF;
 IF NEW.company_id IS DISTINCT FROM app.company_id() OR NOT app.session_active() OR NOT app.allowed('production.read') OR NOT app.allowed('production.issue') OR NOT app.allowed('inventory.read') OR NOT app.allowed('inventory.transfer') THEN RAISE EXCEPTION 'Permission denied' USING ERRCODE='42501'; END IF;
 SELECT * INTO ord FROM app.production_orders WHERE company_id=NEW.company_id AND id=NEW.production_order_id FOR UPDATE;
 IF ord.id IS NULL OR ord.status NOT IN ('planned','ready','in_production') THEN RAISE EXCEPTION 'Planned or active production order required' USING ERRCODE='23514'; END IF;
 IF NEW.kind='reversal' THEN NEW.production_snapshot:=original.production_snapshot; RETURN NEW; END IF;
 IF NEW.kind<>'transfer' OR length(trim(ord.problem))>0 THEN RAISE EXCEPTION 'Production issue blocked' USING ERRCODE='23514'; END IF;
 SELECT * INTO machine FROM app.machines WHERE company_id=NEW.company_id AND id=ord.machine_id FOR SHARE;
 IF machine.id IS NULL OR NOT machine.active THEN RAISE EXCEPTION 'Active order machine required' USING ERRCODE='23514'; END IF;
 -- Use the configured machine location when present; otherwise the operator chooses a production storage location.
 IF machine.location_id IS NOT NULL AND machine.location_id IS DISTINCT FROM (NEW.request->1->>'location_id')::uuid THEN RAISE EXCEPTION 'Use the order machine location' USING ERRCODE='23514'; END IF;
 SELECT x INTO component FROM jsonb_array_elements(coalesce(nullif(ord.snapshot->'bom'->'lines','null'::jsonb),'[]'::jsonb)||coalesce(nullif(ord.snapshot->'packing'->'lines','null'::jsonb),'[]'::jsonb)) x WHERE x->>'component_id'=NEW.request->0->>'item_id' LIMIT 1;
 SELECT * INTO item FROM app.items WHERE company_id=NEW.company_id AND id=(NEW.request->0->>'item_id')::uuid FOR SHARE;
 IF component IS NULL OR item.id IS NULL OR NOT item.active OR item.unit_id::text IS DISTINCT FROM component->'snapshot'->>'unit_id' THEN RAISE EXCEPTION 'Active component with snapshot unit required' USING ERRCODE='23514'; END IF;
 NEW.production_snapshot:=jsonb_build_object('order_id',ord.id,'order_code',ord.code,'order_version',ord.version,'machine',jsonb_build_object('id',machine.id,'code',machine.code,'name',machine.name),'component',component->'snapshot');
 RETURN NEW;
END $$;
-- Alphabetically after entries_prepare, before the existing AFTER posting trigger.
CREATE TRIGGER entries_production_guard BEFORE INSERT ON app.inventory_entries FOR EACH ROW EXECUTE FUNCTION app_private.guard_production_issue();
-- An order cannot be replanned under material already assigned to it. Correction reversals unlock it.
CREATE FUNCTION app_private.guard_issued_order() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF NEW.status='draft' AND OLD.status<>'draft' AND EXISTS(SELECT 1 FROM app.inventory_entries e WHERE e.company_id=OLD.company_id AND e.production_order_id=OLD.id AND e.kind='transfer' AND NOT EXISTS(SELECT 1 FROM app.inventory_entries r WHERE r.company_id=e.company_id AND r.reverses_id=e.id)) THEN RAISE EXCEPTION 'Reverse outstanding material issues before returning to draft' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER production_orders_issue_guard BEFORE UPDATE ON app.production_orders FOR EACH ROW EXECUTE FUNCTION app_private.guard_issued_order();
RESET ROLE;
COMMIT;
