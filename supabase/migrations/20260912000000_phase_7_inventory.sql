-- Inventory foundation only. No receiving, production or shipment workflows.
BEGIN;
-- Owner-executed posting guard may check the existing authenticated session.
GRANT EXECUTE ON FUNCTION app.session_active() TO app_owner;
SET LOCAL ROLE app_owner;
INSERT INTO app.permissions VALUES ('inventory.read','Se lager og posteringer'),('inventory.adjust','Begrundede lagerkorrektioner og ejere');
CREATE TABLE app.stock_owners (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),company_id uuid NOT NULL REFERENCES app.companies,
 code text NOT NULL CHECK(length(trim(code)) BETWEEN 1 AND 60 AND code=trim(code)),
 name text NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 160 AND name=trim(name)),
 kind text NOT NULL CHECK(kind IN ('company','customer','supplier','other')),
 customer_id uuid,supplier_id uuid,active boolean NOT NULL DEFAULT true,notes text NOT NULL DEFAULT '' CHECK(length(notes)<=4000),
 version integer NOT NULL DEFAULT 1 CHECK(version>0),created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(company_id,id),FOREIGN KEY(company_id,customer_id) REFERENCES app.customers(company_id,id),FOREIGN KEY(company_id,supplier_id) REFERENCES app.suppliers(company_id,id),
 CHECK((kind='customer' AND customer_id IS NOT NULL AND supplier_id IS NULL) OR (kind='supplier' AND supplier_id IS NOT NULL AND customer_id IS NULL) OR (kind IN ('company','other') AND customer_id IS NULL AND supplier_id IS NULL))
);
CREATE UNIQUE INDEX stock_owner_code ON app.stock_owners(company_id,lower(code));
CREATE UNIQUE INDEX stock_owner_company ON app.stock_owners(company_id) WHERE kind='company';
CREATE UNIQUE INDEX stock_owner_customer ON app.stock_owners(company_id,customer_id) WHERE customer_id IS NOT NULL;
CREATE UNIQUE INDEX stock_owner_supplier ON app.stock_owners(company_id,supplier_id) WHERE supplier_id IS NOT NULL;
ALTER TABLE app.stock_owners ENABLE ROW LEVEL SECURITY;
CREATE POLICY owners_read ON app.stock_owners FOR SELECT TO app_runtime USING(company_id=app.company_id() AND app.allowed('inventory.read'));
CREATE POLICY owners_insert ON app.stock_owners FOR INSERT TO app_runtime WITH CHECK(company_id=app.company_id() AND app.allowed('inventory.read') AND app.allowed('inventory.adjust'));
CREATE POLICY owners_update ON app.stock_owners FOR UPDATE TO app_runtime USING(company_id=app.company_id() AND app.allowed('inventory.read') AND app.allowed('inventory.adjust')) WITH CHECK(company_id=app.company_id() AND app.allowed('inventory.read') AND app.allowed('inventory.adjust'));
GRANT SELECT ON app.stock_owners TO app_runtime;
GRANT INSERT(company_id,code,name,kind,customer_id,supplier_id,notes) ON app.stock_owners TO app_runtime;
GRANT UPDATE(code,name,active,notes,version) ON app.stock_owners TO app_runtime;
CREATE TRIGGER stock_owners_audit BEFORE INSERT OR UPDATE ON app.stock_owners FOR EACH ROW EXECUTE FUNCTION app_private.audit_masterdata();
CREATE POLICY stock_owner_audit_read ON app.masterdata_audit FOR SELECT TO app_runtime USING(company_id=app.company_id() AND entity_type='stock_owners' AND app.allowed('inventory.read'));
CREATE TABLE app.inventory_entries (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),company_id uuid NOT NULL REFERENCES app.companies,
 idempotency_key uuid NOT NULL,kind text NOT NULL CHECK(kind IN ('correction','reversal')),
 reason text NOT NULL CHECK(length(trim(reason)) BETWEEN 3 AND 1000),reference text NOT NULL DEFAULT '' CHECK(length(reference)<=160),
 request jsonb NOT NULL CHECK(jsonb_typeof(request)='array'),reverses_id uuid,
 actor_id uuid NOT NULL REFERENCES app.profiles,posted_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(company_id,id),UNIQUE(company_id,idempotency_key),UNIQUE(company_id,reverses_id),
 FOREIGN KEY(company_id,reverses_id) REFERENCES app.inventory_entries(company_id,id),
 CHECK((kind='reversal')=(reverses_id IS NOT NULL))
);
CREATE INDEX inventory_entries_time ON app.inventory_entries(company_id,posted_at DESC,id);
CREATE TABLE app.inventory_lines (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),company_id uuid NOT NULL,entry_id uuid NOT NULL,
 item_id uuid NOT NULL,owner_id uuid NOT NULL,location_id uuid NOT NULL,unit_id uuid NOT NULL,
 quantity numeric(20,8) NOT NULL CHECK(quantity<>0 AND quantity<>'NaN'::numeric),snapshot jsonb NOT NULL,
 UNIQUE(company_id,entry_id,item_id,owner_id,location_id),
 FOREIGN KEY(company_id,entry_id) REFERENCES app.inventory_entries(company_id,id),
 FOREIGN KEY(company_id,item_id) REFERENCES app.items(company_id,id),FOREIGN KEY(company_id,owner_id) REFERENCES app.stock_owners(company_id,id),
 FOREIGN KEY(company_id,location_id) REFERENCES app.locations(company_id,id),FOREIGN KEY(company_id,unit_id) REFERENCES app.units(company_id,id)
);
CREATE INDEX inventory_lines_stock ON app.inventory_lines(company_id,item_id,owner_id,location_id,entry_id);
CREATE INDEX inventory_lines_owner ON app.inventory_lines(company_id,owner_id);
CREATE INDEX inventory_lines_location ON app.inventory_lines(company_id,location_id);
CREATE INDEX inventory_lines_unit ON app.inventory_lines(company_id,unit_id);
CREATE TABLE app.stock_balances (
 company_id uuid NOT NULL,item_id uuid NOT NULL,owner_id uuid NOT NULL,location_id uuid NOT NULL,unit_id uuid NOT NULL,
 quantity numeric(20,8) NOT NULL CHECK(quantity>=0 AND quantity<>'NaN'::numeric),snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(company_id,item_id,owner_id,location_id),
 FOREIGN KEY(company_id,item_id) REFERENCES app.items(company_id,id),FOREIGN KEY(company_id,owner_id) REFERENCES app.stock_owners(company_id,id),
 FOREIGN KEY(company_id,location_id) REFERENCES app.locations(company_id,id),FOREIGN KEY(company_id,unit_id) REFERENCES app.units(company_id,id)
);
CREATE INDEX stock_balances_owner ON app.stock_balances(company_id,owner_id);
CREATE INDEX stock_balances_location ON app.stock_balances(company_id,location_id);
CREATE INDEX stock_balances_unit ON app.stock_balances(company_id,unit_id);
ALTER TABLE app.inventory_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.inventory_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.stock_balances ENABLE ROW LEVEL SECURITY;
CREATE POLICY entries_read ON app.inventory_entries FOR SELECT TO app_runtime USING(company_id=app.company_id() AND app.allowed('inventory.read'));
CREATE POLICY entries_insert ON app.inventory_entries FOR INSERT TO app_runtime WITH CHECK(company_id=app.company_id() AND app.allowed('inventory.read') AND app.allowed('inventory.adjust'));
CREATE POLICY lines_read ON app.inventory_lines FOR SELECT TO app_runtime USING(company_id=app.company_id() AND app.allowed('inventory.read'));
CREATE POLICY balances_read ON app.stock_balances FOR SELECT TO app_runtime USING(company_id=app.company_id() AND app.allowed('inventory.read'));
GRANT SELECT ON app.inventory_entries,app.inventory_lines,app.stock_balances TO app_runtime;
GRANT INSERT(company_id,idempotency_key,kind,reason,reference,request,reverses_id) ON app.inventory_entries TO app_runtime;
CREATE FUNCTION app_private.inventory_immutable() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$ BEGIN RAISE EXCEPTION 'Posted inventory is immutable' USING ERRCODE='23514'; END $$;
CREATE TRIGGER entries_immutable BEFORE UPDATE OR DELETE ON app.inventory_entries FOR EACH ROW EXECUTE FUNCTION app_private.inventory_immutable();
CREATE TRIGGER lines_immutable BEFORE UPDATE OR DELETE ON app.inventory_lines FOR EACH ROW EXECUTE FUNCTION app_private.inventory_immutable();
CREATE FUNCTION app_private.prepare_inventory() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF NEW.company_id IS DISTINCT FROM app.company_id() OR NOT app.session_active() OR EXISTS(SELECT 1 FROM app.revoked_sessions WHERE session_id=nullif(current_setting('app.session_id',true),'')::uuid) OR NOT app.allowed('inventory.read') OR NOT app.allowed('inventory.adjust') THEN RAISE EXCEPTION 'Permission denied' USING ERRCODE='42501'; END IF;
 NEW.actor_id:=app.actor_id();NEW.posted_at:=clock_timestamp();
 IF NEW.kind='correction' THEN
  IF NEW.reverses_id IS NOT NULL OR jsonb_array_length(NEW.request) NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'Invalid correction' USING ERRCODE='23514'; END IF;
 ELSE
  IF NEW.kind<>'reversal' OR NEW.request<>'[]'::jsonb OR NOT EXISTS(SELECT 1 FROM app.inventory_entries WHERE company_id=NEW.company_id AND id=NEW.reverses_id AND kind='correction') THEN RAISE EXCEPTION 'Invalid reversal' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER entries_prepare BEFORE INSERT ON app.inventory_entries FOR EACH ROW EXECUTE FUNCTION app_private.prepare_inventory();
CREATE FUNCTION app_private.post_inventory() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE line jsonb; lines jsonb; i app.items; o app.stock_owners; l app.locations; u app.units; qty numeric; snap jsonb; duplicate_count integer;
BEGIN
 -- Only this trigger owns journal-line and balance writes; runtime has no DML grants.
 IF NEW.kind='reversal' THEN
  SELECT jsonb_agg(jsonb_build_object('item_id',item_id,'owner_id',owner_id,'location_id',location_id,'quantity',(-quantity)::text)) INTO lines FROM app.inventory_lines WHERE company_id=NEW.company_id AND entry_id=NEW.reverses_id;
 ELSE lines:=NEW.request; END IF;
 IF lines IS NULL OR jsonb_typeof(lines)<>'array' THEN RAISE EXCEPTION 'Invalid lines' USING ERRCODE='23514'; END IF;
 FOR line IN SELECT value FROM jsonb_array_elements(lines) LOOP
  IF jsonb_typeof(line)<>'object' OR NOT(line ?& ARRAY['item_id','owner_id','location_id','quantity']) OR (line-ARRAY['item_id','owner_id','location_id','quantity'])<>'{}'::jsonb OR jsonb_typeof(line->'quantity')<>'string' OR (line->>'quantity')!~'^-?(0|[1-9][0-9]{0,11})(\.[0-9]{1,8})?$' THEN RAISE EXCEPTION 'Invalid inventory line' USING ERRCODE='23514'; END IF;
 END LOOP;
 SELECT count(*)-count(DISTINCT (value->>'item_id',value->>'owner_id',value->>'location_id')) INTO duplicate_count FROM jsonb_array_elements(lines);
 IF duplicate_count>0 THEN RAISE EXCEPTION 'Duplicate balance key' USING ERRCODE='23514'; END IF;
 -- Identical global order for all commands limits deadlocks across overlapping sets.
 FOR line IN SELECT value FROM jsonb_array_elements(lines) ORDER BY value->>'item_id',value->>'owner_id',value->>'location_id' LOOP
  qty:=(line->>'quantity')::numeric;
  IF qty=0 THEN RAISE EXCEPTION 'Zero quantity' USING ERRCODE='23514'; END IF;
  SELECT * INTO i FROM app.items WHERE company_id=NEW.company_id AND id=(line->>'item_id')::uuid FOR SHARE;
  SELECT * INTO o FROM app.stock_owners WHERE company_id=NEW.company_id AND id=(line->>'owner_id')::uuid FOR SHARE;
  SELECT * INTO l FROM app.locations WHERE company_id=NEW.company_id AND id=(line->>'location_id')::uuid FOR SHARE;
  SELECT * INTO u FROM app.units WHERE company_id=NEW.company_id AND id=i.unit_id FOR SHARE;
  IF i.id IS NULL OR o.id IS NULL OR l.id IS NULL OR u.id IS NULL OR (qty>0 AND (NOT i.active OR NOT o.active OR NOT l.active OR NOT l.is_storage OR NOT u.active)) THEN RAISE EXCEPTION 'Valid inventory references required' USING ERRCODE='23514'; END IF;
  IF u.dimension IN ('count','package') AND qty<>trunc(qty) THEN RAISE EXCEPTION 'Whole units required' USING ERRCODE='23514'; END IF;
  snap:=jsonb_build_object('item',jsonb_build_object('code',i.code,'name',i.name,'kind',i.kind),'owner',jsonb_build_object('code',o.code,'name',o.name,'kind',o.kind),'location',jsonb_build_object('code',l.code,'name',l.name),'unit',jsonb_build_object('code',u.code,'name',u.name,'symbol',u.symbol,'dimension',u.dimension));
  snap:=snap||jsonb_build_object('location_path',(WITH RECURSIVE chain AS (SELECT id,parent_id,code,name,0 depth FROM app.locations WHERE company_id=NEW.company_id AND id=l.id UNION ALL SELECT x.id,x.parent_id,x.code,x.name,c.depth+1 FROM app.locations x JOIN chain c ON x.id=c.parent_id WHERE x.company_id=NEW.company_id AND c.depth<31) SELECT jsonb_agg(jsonb_build_object('id',id,'code',code,'name',name) ORDER BY depth DESC) FROM chain));
  -- Initialise at zero before debit: a negative INSERT must never bypass CHECK.
  INSERT INTO app.stock_balances(company_id,item_id,owner_id,location_id,unit_id,quantity) VALUES(NEW.company_id,i.id,o.id,l.id,u.id,0) ON CONFLICT DO NOTHING;
  UPDATE app.stock_balances SET quantity=quantity+qty,snapshot=snap,updated_at=clock_timestamp() WHERE company_id=NEW.company_id AND item_id=i.id AND owner_id=o.id AND location_id=l.id AND unit_id=u.id AND quantity+qty>=0;
  IF NOT FOUND THEN RAISE EXCEPTION 'Insufficient physical stock' USING ERRCODE='23514'; END IF;
  INSERT INTO app.inventory_lines(company_id,entry_id,item_id,owner_id,location_id,unit_id,quantity,snapshot) VALUES(NEW.company_id,NEW.id,i.id,o.id,l.id,u.id,qty,snap);
 END LOOP;
 RETURN NEW;
END $$;
CREATE TRIGGER entries_post AFTER INSERT ON app.inventory_entries FOR EACH ROW EXECUTE FUNCTION app_private.post_inventory();
RESET ROLE;
COMMIT;
