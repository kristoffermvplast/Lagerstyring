-- Count one exact item/owner/location balance, preserving the existing journal and reservation rules.
BEGIN;
SET LOCAL ROLE app_owner;
INSERT INTO app.permissions VALUES ('counts.read','Se lageroptællinger'),('counts.manage','Oprette og registrere optællinger'),('counts.approve','Godkende optællingskorrektioner');
ALTER TABLE app.stock_balances ADD COLUMN physical_revision bigint NOT NULL DEFAULT 0 CHECK(physical_revision>=0);
CREATE FUNCTION app_private.advance_physical_revision() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
 NEW.physical_revision:=OLD.physical_revision+CASE WHEN NEW.quantity IS DISTINCT FROM OLD.quantity THEN 1 ELSE 0 END;
 RETURN NEW;
END $$;
CREATE TRIGGER physical_revision BEFORE UPDATE ON app.stock_balances FOR EACH ROW EXECUTE FUNCTION app_private.advance_physical_revision();
CREATE TABLE app.stock_counts (
 id uuid PRIMARY KEY,company_id uuid NOT NULL REFERENCES app.companies,item_id uuid NOT NULL,owner_id uuid NOT NULL,location_id uuid NOT NULL,unit_id uuid NOT NULL,
 baseline_quantity numeric(20,8) NOT NULL,baseline_revision bigint NOT NULL, snapshot jsonb NOT NULL,
 counted_quantity numeric(20,8) CHECK(counted_quantity>=0 AND counted_quantity<'Infinity'::numeric),
 status text NOT NULL CHECK(status IN ('open','counted','approved','cancelled')),version integer NOT NULL DEFAULT 1 CHECK(version>0),
 reason text NOT NULL,created_by uuid NOT NULL REFERENCES app.profiles,created_at timestamptz NOT NULL,
 counted_by uuid REFERENCES app.profiles,counted_at timestamptz,approved_by uuid REFERENCES app.profiles,approved_at timestamptz,entry_id uuid,
 UNIQUE(company_id,id),
 FOREIGN KEY(company_id,item_id,owner_id,location_id) REFERENCES app.stock_balances(company_id,item_id,owner_id,location_id),
 FOREIGN KEY(company_id,unit_id) REFERENCES app.units(company_id,id),
 FOREIGN KEY(company_id,entry_id) REFERENCES app.inventory_entries(company_id,id),
 CHECK(status NOT IN ('counted','approved') OR counted_quantity IS NOT NULL)
);
CREATE UNIQUE INDEX stock_counts_open ON app.stock_counts(company_id,item_id,owner_id,location_id) WHERE status IN ('open','counted');
CREATE INDEX stock_counts_time ON app.stock_counts(company_id,created_at DESC,id);
CREATE TABLE app.count_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),company_id uuid NOT NULL REFERENCES app.companies,idempotency_key uuid NOT NULL,
 count_id uuid NOT NULL,action text NOT NULL CHECK(action IN ('start','record','approve','cancel')),
 request jsonb NOT NULL CHECK(jsonb_typeof(request)='object'),reason text NOT NULL CHECK(length(trim(reason)) BETWEEN 3 AND 1000),
 actor_id uuid NOT NULL REFERENCES app.profiles,created_at timestamptz NOT NULL,result jsonb NOT NULL,
 UNIQUE(company_id,idempotency_key),FOREIGN KEY(company_id,count_id) REFERENCES app.stock_counts(company_id,id) DEFERRABLE INITIALLY DEFERRED
);
CREATE INDEX count_events_history ON app.count_events(company_id,count_id,created_at,id);
ALTER TABLE app.stock_counts ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.count_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY read ON app.stock_counts FOR SELECT TO app_runtime USING(company_id=app.company_id() AND app.allowed('counts.read') AND app.allowed('inventory.read'));
CREATE POLICY read ON app.count_events FOR SELECT TO app_runtime USING(company_id=app.company_id() AND app.allowed('counts.read') AND app.allowed('inventory.read'));
CREATE POLICY command ON app.count_events FOR INSERT TO app_runtime WITH CHECK(company_id=app.company_id() AND app.allowed('counts.read') AND app.allowed('inventory.read') AND app.allowed(CASE WHEN action='approve' THEN 'counts.approve' ELSE 'counts.manage' END));
REVOKE ALL ON app.stock_counts,app.count_events FROM PUBLIC,anon,authenticated,app_runtime;
GRANT SELECT ON app.stock_counts,app.count_events TO app_runtime;
GRANT INSERT(company_id,idempotency_key,count_id,action,request,reason) ON app.count_events TO app_runtime;
CREATE TRIGGER immutable BEFORE UPDATE OR DELETE ON app.count_events FOR EACH ROW EXECUTE FUNCTION app_private.inventory_immutable();
CREATE FUNCTION app_private.command_count() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE c app.stock_counts;b app.stock_balances;q numeric;delta numeric;entry uuid;
BEGIN
 IF NEW.company_id IS DISTINCT FROM app.company_id() OR NOT app.session_active() OR EXISTS(SELECT 1 FROM app.revoked_sessions WHERE session_id=nullif(current_setting('app.session_id',true),'')::uuid) OR NOT app.allowed('counts.read') OR NOT app.allowed('inventory.read') OR NOT app.allowed(CASE WHEN NEW.action='approve' THEN 'counts.approve' ELSE 'counts.manage' END) THEN RAISE EXCEPTION 'Permission denied' USING ERRCODE='42501';END IF;
 NEW.actor_id:=app.actor_id();NEW.created_at:=clock_timestamp();
 IF NEW.action='start' THEN
  IF NOT(NEW.request ?& ARRAY['item_id','owner_id','location_id']) OR NEW.request-ARRAY['item_id','owner_id','location_id']<>'{}'::jsonb THEN RAISE EXCEPTION 'Invalid count' USING ERRCODE='23514';END IF;
  SELECT * INTO b FROM app.stock_balances WHERE company_id=NEW.company_id AND item_id=(NEW.request->>'item_id')::uuid AND owner_id=(NEW.request->>'owner_id')::uuid AND location_id=(NEW.request->>'location_id')::uuid FOR UPDATE;
  IF b.company_id IS NULL THEN RAISE EXCEPTION 'Existing balance required' USING ERRCODE='23514';END IF;
  INSERT INTO app.stock_counts(id,company_id,item_id,owner_id,location_id,unit_id,baseline_quantity,baseline_revision,snapshot,status,reason,created_by,created_at)
  VALUES(NEW.count_id,NEW.company_id,b.item_id,b.owner_id,b.location_id,b.unit_id,b.quantity,b.physical_revision,b.snapshot,'open',NEW.reason,NEW.actor_id,NEW.created_at);
 ELSE
  IF NOT(NEW.request ? 'version') OR jsonb_typeof(NEW.request->'version') IS DISTINCT FROM 'number' OR (NEW.request->>'version')!~'^[1-9][0-9]{0,9}$' OR NEW.request-(CASE WHEN NEW.action='record' THEN ARRAY['version','quantity'] ELSE ARRAY['version'] END)<>'{}'::jsonb THEN RAISE EXCEPTION 'Invalid count command' USING ERRCODE='23514';END IF;
  SELECT * INTO c FROM app.stock_counts WHERE company_id=NEW.company_id AND id=NEW.count_id FOR UPDATE;
  IF c.id IS NULL OR c.version<>(NEW.request->>'version')::bigint OR c.status NOT IN ('open','counted') THEN RAISE EXCEPTION 'Count changed or closed' USING ERRCODE='23514';END IF;
  IF NEW.action='cancel' THEN
   UPDATE app.stock_counts SET status='cancelled',version=version+1 WHERE id=c.id;
  ELSE
   SELECT * INTO b FROM app.stock_balances WHERE company_id=c.company_id AND item_id=c.item_id AND owner_id=c.owner_id AND location_id=c.location_id FOR UPDATE;
   IF b.physical_revision<>c.baseline_revision THEN RAISE EXCEPTION 'Stock moved: cancel and recount' USING ERRCODE='23514';END IF;
   IF NEW.action='record' THEN
    IF jsonb_typeof(NEW.request->'quantity') IS DISTINCT FROM 'string' OR (NEW.request->>'quantity')!~'^(0|[1-9][0-9]{0,11})(\.[0-9]{1,8})?$' THEN RAISE EXCEPTION 'Invalid counted quantity' USING ERRCODE='23514';END IF;
    q:=(NEW.request->>'quantity')::numeric;
    IF EXISTS(SELECT 1 FROM app.units WHERE company_id=c.company_id AND id=c.unit_id AND dimension IN ('count','package')) AND q<>trunc(q) THEN RAISE EXCEPTION 'Whole units required' USING ERRCODE='23514';END IF;
    UPDATE app.stock_counts SET counted_quantity=q,counted_by=NEW.actor_id,counted_at=NEW.created_at,status='counted',version=version+1 WHERE id=c.id;
   ELSIF NEW.action='approve' THEN
    IF NOT app.allowed('inventory.adjust') THEN RAISE EXCEPTION 'Permission denied' USING ERRCODE='42501';END IF;
    IF c.status<>'counted' THEN RAISE EXCEPTION 'Recorded count required' USING ERRCODE='23514';END IF;
    delta:=c.counted_quantity-c.baseline_quantity;
    IF delta<>0 THEN
     -- Reuse the journal owner. Its guards reject negatives, protected pallets and reservations.
     -- Reservation releases remain explicit, using the existing reservation/shipment workflow.
     INSERT INTO app.inventory_entries(company_id,idempotency_key,kind,reason,reference,request)
     VALUES(c.company_id,gen_random_uuid(),'correction',NEW.reason,'Optælling '||c.id::text,jsonb_build_array(jsonb_build_object('item_id',c.item_id,'owner_id',c.owner_id,'location_id',c.location_id,'quantity',delta::text))) RETURNING id INTO entry;
    END IF;
    UPDATE app.stock_counts SET status='approved',approved_by=NEW.actor_id,approved_at=NEW.created_at,entry_id=entry,version=version+1 WHERE id=c.id;
   ELSE RAISE EXCEPTION 'Invalid action' USING ERRCODE='23514';END IF;
  END IF;
 END IF;
 SELECT * INTO c FROM app.stock_counts WHERE company_id=NEW.company_id AND id=NEW.count_id;
 NEW.result:=to_jsonb(c)||jsonb_build_object('baseline_quantity',c.baseline_quantity::text,'baseline_revision',c.baseline_revision::text,'counted_quantity',c.counted_quantity::text);
 RETURN NEW;
END $$;
CREATE TRIGGER command BEFORE INSERT ON app.count_events FOR EACH ROW EXECUTE FUNCTION app_private.command_count();
REVOKE ALL ON FUNCTION app_private.command_count(),app_private.advance_physical_revision() FROM PUBLIC,anon,authenticated,app_runtime;
RESET ROLE;
COMMIT;
