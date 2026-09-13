-- Phase 14: measured waste observations only. No inventory or closure modifications.
BEGIN;
SET LOCAL ROLE app_owner;
INSERT INTO app.permissions VALUES ('production.waste','Registrere målt fysisk spild'),('production.waste.correct','Modregistrere fysisk spild');
CREATE TABLE app.production_waste (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid NOT NULL, order_id uuid NOT NULL,
 idempotency_key uuid NOT NULL, kind text NOT NULL CHECK(kind IN ('record','reversal')),
 issue_id uuid NOT NULL, item_id uuid NOT NULL, owner_id uuid NOT NULL, unit_id uuid NOT NULL,
 quantity numeric(20,8) NOT NULL CHECK(quantity>0 AND quantity<'Infinity'::numeric),
 comment text NOT NULL CHECK(length(trim(comment)) BETWEEN 3 AND 2000), reverses_id uuid,
 snapshot jsonb NOT NULL DEFAULT '{}', created_by uuid NOT NULL DEFAULT app.actor_id() REFERENCES app.profiles(id),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(company_id,id),UNIQUE(company_id,idempotency_key),UNIQUE(company_id,reverses_id),
 FOREIGN KEY(company_id,order_id) REFERENCES app.production_orders(company_id,id),
 FOREIGN KEY(company_id,issue_id) REFERENCES app.inventory_entries(company_id,id),
 FOREIGN KEY(company_id,item_id) REFERENCES app.items(company_id,id),
 FOREIGN KEY(company_id,owner_id) REFERENCES app.stock_owners(company_id,id),
 FOREIGN KEY(company_id,unit_id) REFERENCES app.units(company_id,id),
 FOREIGN KEY(company_id,reverses_id) REFERENCES app.production_waste(company_id,id),
 CHECK((kind='record' AND reverses_id IS NULL) OR (kind='reversal' AND reverses_id IS NOT NULL))
);
CREATE INDEX production_waste_history ON app.production_waste(company_id,order_id,created_at,id);
CREATE INDEX production_waste_issue ON app.production_waste(company_id,issue_id);
ALTER TABLE app.production_waste ENABLE ROW LEVEL SECURITY;
CREATE POLICY read ON app.production_waste FOR SELECT TO app_runtime USING(company_id=app.company_id() AND app.allowed('production.read') AND app.allowed('inventory.read'));
CREATE POLICY insert_waste ON app.production_waste FOR INSERT TO app_runtime WITH CHECK(company_id=app.company_id() AND app.allowed('production.read') AND app.allowed('inventory.read') AND app.allowed(CASE WHEN kind='record' THEN 'production.waste' ELSE 'production.waste.correct' END));
REVOKE ALL ON app.production_waste FROM PUBLIC,anon,authenticated;
GRANT SELECT ON app.production_waste TO app_runtime;
GRANT INSERT(company_id,order_id,idempotency_key,kind,issue_id,quantity,comment,reverses_id) ON app.production_waste TO app_runtime;
CREATE FUNCTION app_private.prepare_production_waste() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE o app.production_orders; original app.production_waste; line app.inventory_lines; issue app.inventory_entries;
BEGIN
 IF NEW.company_id IS DISTINCT FROM app.company_id() OR app.actor_id() IS NULL OR NOT app.allowed('production.read') OR NOT app.allowed('inventory.read') OR NOT app.allowed(CASE WHEN NEW.kind='reversal' THEN 'production.waste.correct' ELSE 'production.waste' END) THEN RAISE EXCEPTION 'Permission denied' USING ERRCODE='42501'; END IF;
 SELECT * INTO o FROM app.production_orders WHERE company_id=NEW.company_id AND id=NEW.order_id FOR UPDATE;
 IF o.id IS NULL OR o.status NOT IN ('in_production','reconciliation','completed') THEN RAISE EXCEPTION 'Started production required' USING ERRCODE='23514'; END IF;
 IF NEW.kind='record' THEN
  SELECT * INTO issue FROM app.inventory_entries WHERE company_id=NEW.company_id AND production_order_id=NEW.order_id AND id=NEW.issue_id AND kind='transfer' AND production_return_of IS NULL;
  IF issue.id IS NULL OR EXISTS(SELECT 1 FROM app.inventory_entries WHERE company_id=NEW.company_id AND reverses_id=issue.id) THEN RAISE EXCEPTION 'Unreversed original issue required' USING ERRCODE='23514'; END IF;
  SELECT * INTO STRICT line FROM app.inventory_lines WHERE company_id=NEW.company_id AND entry_id=issue.id AND quantity>0;
  IF line.snapshot->'unit'->>'dimension' IN ('count','package') AND NEW.quantity<>trunc(NEW.quantity) THEN RAISE EXCEPTION 'Whole units required' USING ERRCODE='23514'; END IF;
  NEW.item_id:=line.item_id;NEW.owner_id:=line.owner_id;NEW.unit_id:=line.unit_id;
  NEW.snapshot:=jsonb_build_object('stock',line.snapshot,'production',issue.production_snapshot,'order_id',o.id,'order_code',o.code,'order_status',o.status);
 ELSE
  SELECT * INTO original FROM app.production_waste WHERE company_id=NEW.company_id AND order_id=NEW.order_id AND id=NEW.reverses_id AND kind='record';
  IF original.id IS NULL OR EXISTS(SELECT 1 FROM app.production_waste WHERE company_id=NEW.company_id AND reverses_id=original.id) THEN RAISE EXCEPTION 'Unreversed waste record required' USING ERRCODE='23514'; END IF;
  NEW.issue_id:=original.issue_id;NEW.item_id:=original.item_id;NEW.owner_id:=original.owner_id;NEW.unit_id:=original.unit_id;NEW.quantity:=original.quantity;NEW.snapshot:=original.snapshot;
 END IF;
 NEW.created_by:=app.actor_id();NEW.created_at:=clock_timestamp();RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION app_private.prepare_production_waste() FROM PUBLIC,anon,authenticated,app_runtime;
CREATE TRIGGER production_waste_prepare BEFORE INSERT ON app.production_waste FOR EACH ROW EXECUTE FUNCTION app_private.prepare_production_waste();
CREATE TRIGGER production_waste_immutable BEFORE UPDATE OR DELETE ON app.production_waste FOR EACH ROW EXECUTE FUNCTION app_private.immutable_production_registration();
CREATE INDEX production_closures_period ON app.production_closures(company_id,created_at,id);
RESET ROLE;
COMMIT;
