-- Separate reusable-packaging debt ledger; never posts physical inventory.
BEGIN;
SET LOCAL ROLE app_owner;
INSERT INTO app.permissions VALUES ('pallets.read','Se pallemellemværender'),('pallets.manage','Registrere pallebevægelser'),('pallets.adjust','Korrigere pallemellemværender');
ALTER TABLE app.shipments ADD COLUMN pallet_exchange jsonb NOT NULL DEFAULT '[]' CHECK(jsonb_typeof(pallet_exchange)='array');
CREATE TABLE app.pallet_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),company_id uuid NOT NULL REFERENCES app.companies,idempotency_key uuid NOT NULL,
 action text NOT NULL CHECK(action IN ('outbound','inbound','correction','reverse','declare')),
 request jsonb NOT NULL CHECK(jsonb_typeof(request)='object'),reason text NOT NULL CHECK(length(trim(reason)) BETWEEN 3 AND 1000),
 actor_id uuid NOT NULL REFERENCES app.profiles,created_at timestamptz NOT NULL,result jsonb NOT NULL,
 UNIQUE(company_id,id),UNIQUE(company_id,idempotency_key)
);
CREATE TABLE app.pallet_entries (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),company_id uuid NOT NULL REFERENCES app.companies,
 customer_id uuid,supplier_id uuid,pallet_type_id uuid NOT NULL,
 quantity numeric(20,0) NOT NULL CHECK(quantity<>0 AND quantity>'-Infinity'::numeric AND quantity<'Infinity'::numeric),
 kind text NOT NULL CHECK(kind IN ('outbound','inbound','correction','reverse','shipment')),
 occurred_on date NOT NULL,reference text NOT NULL,reason text NOT NULL,actor_id uuid NOT NULL REFERENCES app.profiles,created_at timestamptz NOT NULL,
 snapshot jsonb NOT NULL,event_id uuid,shipment_id uuid,reverses_id uuid,
 UNIQUE(company_id,id),UNIQUE(company_id,event_id),UNIQUE(company_id,reverses_id),UNIQUE(company_id,shipment_id,pallet_type_id),
 CHECK(num_nonnulls(customer_id,supplier_id)=1),CHECK(num_nonnulls(event_id,shipment_id)=1),
 CHECK((kind='shipment')=(shipment_id IS NOT NULL)),CHECK((kind='reverse')=(reverses_id IS NOT NULL)),
 CHECK(kind NOT IN ('outbound','shipment') OR quantity>0),CHECK(kind<>'inbound' OR quantity<0),
 FOREIGN KEY(company_id,customer_id) REFERENCES app.customers(company_id,id),
 FOREIGN KEY(company_id,supplier_id) REFERENCES app.suppliers(company_id,id),
 FOREIGN KEY(company_id,pallet_type_id) REFERENCES app.pallet_types(company_id,id),
 FOREIGN KEY(company_id,event_id) REFERENCES app.pallet_events(company_id,id) DEFERRABLE INITIALLY DEFERRED,
 FOREIGN KEY(company_id,shipment_id) REFERENCES app.shipments(company_id,id),
 FOREIGN KEY(company_id,reverses_id) REFERENCES app.pallet_entries(company_id,id)
);
CREATE INDEX pallet_entries_accounts ON app.pallet_entries(company_id,customer_id,supplier_id,pallet_type_id,occurred_on,id);
CREATE INDEX pallet_entries_history ON app.pallet_entries(company_id,occurred_on,id);
ALTER TABLE app.pallet_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.pallet_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY read ON app.pallet_entries FOR SELECT TO app_runtime USING(company_id=app.company_id() AND app.allowed('pallets.read'));
CREATE POLICY read ON app.pallet_events FOR SELECT TO app_runtime USING(company_id=app.company_id() AND app.allowed('pallets.read'));
CREATE POLICY write ON app.pallet_events FOR INSERT TO app_runtime WITH CHECK(company_id=app.company_id() AND app.allowed('pallets.read') AND app.allowed(CASE WHEN action IN ('correction','reverse') THEN 'pallets.adjust' ELSE 'pallets.manage' END));
REVOKE ALL ON app.pallet_events,app.pallet_entries FROM PUBLIC,anon,authenticated;
GRANT SELECT ON app.pallet_events,app.pallet_entries TO app_runtime;
GRANT INSERT(company_id,idempotency_key,action,request,reason) ON app.pallet_events TO app_runtime;
CREATE TRIGGER immutable BEFORE UPDATE OR DELETE ON app.pallet_events FOR EACH ROW EXECUTE FUNCTION app_private.inventory_immutable();
CREATE TRIGGER immutable BEFORE UPDATE OR DELETE ON app.pallet_entries FOR EACH ROW EXECUTE FUNCTION app_private.inventory_immutable();
CREATE FUNCTION app_private.command_pallet() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE p app.pallet_types;e app.pallet_entries;s app.shipments;cust app.customers;supp app.suppliers;line jsonb;cooked jsonb:='[]';qty numeric;party jsonb;
BEGIN
 IF NEW.company_id IS DISTINCT FROM app.company_id() OR NOT app.session_active() OR EXISTS(SELECT 1 FROM app.revoked_sessions WHERE session_id=nullif(current_setting('app.session_id',true),'')::uuid) OR NOT app.allowed('pallets.read') OR NOT app.allowed(CASE WHEN NEW.action IN ('correction','reverse') THEN 'pallets.adjust' ELSE 'pallets.manage' END) THEN RAISE EXCEPTION 'Permission denied' USING ERRCODE='42501';END IF;
 NEW.actor_id:=app.actor_id();NEW.created_at:=clock_timestamp();
 IF NEW.action='declare' THEN
  IF NOT app.allowed('shipments.read') OR NOT app.allowed('shipments.manage') OR NOT app.allowed('masterdata.read') THEN RAISE EXCEPTION 'Permission denied' USING ERRCODE='42501';END IF;
  IF NOT(NEW.request ?& ARRAY['shipment_id','version','lines']) OR NEW.request-ARRAY['shipment_id','version','lines']<>'{}'::jsonb OR jsonb_typeof(NEW.request->'lines') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Invalid declaration' USING ERRCODE='23514';END IF;
  SELECT * INTO s FROM app.shipments WHERE company_id=NEW.company_id AND id=(NEW.request->>'shipment_id')::uuid FOR UPDATE;
  IF s.id IS NULL OR s.status<>'draft' OR (NEW.request->>'version')::integer IS DISTINCT FROM s.version OR jsonb_array_length(NEW.request->'lines')>100 THEN RAISE EXCEPTION 'Stale or non-draft shipment' USING ERRCODE='23514';END IF;
  FOR line IN SELECT value FROM jsonb_array_elements(NEW.request->'lines') LOOP
   IF NOT(line ?& ARRAY['pallet_type_id','quantity']) OR line-ARRAY['pallet_type_id','quantity']<>'{}'::jsonb OR coalesce(line->>'quantity','')!~'^[1-9][0-9]{0,8}$' OR jsonb_typeof(line->'quantity')<>'string' THEN RAISE EXCEPTION 'Positive integer required' USING ERRCODE='23514';END IF;
   SELECT * INTO p FROM app.pallet_types WHERE company_id=NEW.company_id AND id=(line->>'pallet_type_id')::uuid AND active FOR SHARE;
   IF p.id IS NULL OR EXISTS(SELECT 1 FROM jsonb_array_elements(cooked) x WHERE x->>'pallet_type_id'=p.id::text) THEN RAISE EXCEPTION 'Invalid or duplicate type' USING ERRCODE='23514';END IF;
   cooked:=cooked||jsonb_build_array(line||jsonb_build_object('snapshot',jsonb_build_object('code',p.code,'name',p.name)));
  END LOOP;
  UPDATE app.shipments SET pallet_exchange=cooked,version=version+1,updated_at=NEW.created_at WHERE company_id=s.company_id AND id=s.id RETURNING * INTO s;
  NEW.result:=jsonb_build_object('id',s.id,'version',s.version,'lines',cooked);RETURN NEW;
 END IF;
 IF NEW.action='reverse' THEN
  IF NOT(NEW.request ? 'entry_id') OR NEW.request-ARRAY['entry_id']<>'{}'::jsonb THEN RAISE EXCEPTION 'Invalid reversal' USING ERRCODE='23514';END IF;
  SELECT * INTO e FROM app.pallet_entries WHERE company_id=NEW.company_id AND id=(NEW.request->>'entry_id')::uuid FOR UPDATE;
  IF e.id IS NULL OR e.kind='reverse' OR EXISTS(SELECT 1 FROM app.pallet_entries WHERE company_id=NEW.company_id AND reverses_id=e.id) THEN RAISE EXCEPTION 'Already reversed or invalid entry' USING ERRCODE='23514';END IF;
  e.reverses_id:=e.id;e.quantity:=-e.quantity;e.kind:='reverse';e.shipment_id:=NULL;e.occurred_on:=CURRENT_DATE;
 ELSE
  IF NOT app.allowed('masterdata.read') THEN RAISE EXCEPTION 'Permission denied' USING ERRCODE='42501';END IF;
  IF NOT(NEW.request ?& ARRAY['customer_id','supplier_id','pallet_type_id','quantity','occurred_on','reference']) OR NEW.request-ARRAY['customer_id','supplier_id','pallet_type_id','quantity','occurred_on','reference']<>'{}'::jsonb OR num_nonnulls(NEW.request->>'customer_id',NEW.request->>'supplier_id')<>1 OR coalesce(NEW.request->>'quantity','')!~'^-?[1-9][0-9]{0,8}$' OR jsonb_typeof(NEW.request->'quantity')<>'string' OR coalesce(length(NEW.request->>'reference'),161)>160 OR coalesce(NEW.request->>'occurred_on','')!~'^\d{4}-\d{2}-\d{2}$' THEN RAISE EXCEPTION 'Invalid movement' USING ERRCODE='23514';END IF;
  qty:=(NEW.request->>'quantity')::numeric;
  IF NEW.action<>'correction' AND qty<0 THEN RAISE EXCEPTION 'Positive quantity required' USING ERRCODE='23514';END IF;
  SELECT * INTO p FROM app.pallet_types WHERE company_id=NEW.company_id AND id=(NEW.request->>'pallet_type_id')::uuid AND active FOR SHARE;
  SELECT * INTO cust FROM app.customers WHERE company_id=NEW.company_id AND id=(NEW.request->>'customer_id')::uuid AND active FOR SHARE;
  SELECT * INTO supp FROM app.suppliers WHERE company_id=NEW.company_id AND id=(NEW.request->>'supplier_id')::uuid AND active FOR SHARE;
  IF p.id IS NULL OR cust.id IS NULL AND supp.id IS NULL THEN RAISE EXCEPTION 'Active company references required' USING ERRCODE='23514';END IF;
  party:=CASE WHEN cust.id IS NOT NULL THEN jsonb_build_object('kind','customer','code',cust.code,'name',cust.name) ELSE jsonb_build_object('kind','supplier','code',supp.code,'name',supp.name) END;
  e.customer_id:=cust.id;e.supplier_id:=supp.id;e.pallet_type_id:=p.id;e.quantity:=CASE WHEN NEW.action='inbound' THEN -qty ELSE qty END;e.kind:=NEW.action;e.occurred_on:=(NEW.request->>'occurred_on')::date;e.reference:=NEW.request->>'reference';e.snapshot:=jsonb_build_object('party',party,'type',jsonb_build_object('code',p.code,'name',p.name));
 END IF;
 e.id:=gen_random_uuid();e.company_id:=NEW.company_id;e.event_id:=NEW.id;e.reason:=NEW.reason;e.actor_id:=NEW.actor_id;e.created_at:=NEW.created_at;
 INSERT INTO app.pallet_entries SELECT e.*;
 NEW.result:=to_jsonb(e)||jsonb_build_object('quantity',e.quantity::text);RETURN NEW;
END $$;
CREATE TRIGGER command BEFORE INSERT ON app.pallet_events FOR EACH ROW EXECUTE FUNCTION app_private.command_pallet();
-- Same transaction as physical dispatch; no additional inventory consumption.
CREATE FUNCTION app_private.dispatch_pallet_exchange() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE line jsonb;
BEGIN
 IF NEW.status='dispatched' AND OLD.status IS DISTINCT FROM 'dispatched' AND jsonb_array_length(NEW.pallet_exchange)>0 THEN
  IF NEW.company_id IS DISTINCT FROM app.company_id() OR NOT app.session_active() OR NOT app.allowed('shipments.dispatch') OR NOT app.allowed('pallets.read') OR NOT app.allowed('pallets.manage') THEN RAISE EXCEPTION 'Pallet permission required' USING ERRCODE='42501';END IF;
  FOR line IN SELECT value FROM jsonb_array_elements(NEW.pallet_exchange) LOOP
   INSERT INTO app.pallet_entries(company_id,customer_id,pallet_type_id,quantity,kind,occurred_on,reference,reason,actor_id,created_at,snapshot,shipment_id)
   VALUES(NEW.company_id,NEW.customer_id,(line->>'pallet_type_id')::uuid,(line->>'quantity')::numeric,'shipment',NEW.ship_date,NEW.code,'Forsendelse afsendt',app.actor_id(),clock_timestamp(),jsonb_build_object('party',NEW.snapshot->'customer'||jsonb_build_object('kind','customer'),'type',line->'snapshot'),NEW.id);
  END LOOP;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER pallet_dispatch AFTER UPDATE ON app.shipments FOR EACH ROW EXECUTE FUNCTION app_private.dispatch_pallet_exchange();
REVOKE ALL ON FUNCTION app_private.command_pallet(),app_private.dispatch_pallet_exchange() FROM PUBLIC,anon,authenticated,app_runtime;
COMMIT;
