-- Reservations are separate from physical inventory. No shipment workflow.
BEGIN;
SET LOCAL ROLE app_owner;
INSERT INTO app.permissions VALUES ('inventory.reserve','Reservere og frigive lager');
ALTER TABLE app.stock_balances ADD COLUMN reserved_quantity numeric(20,8) NOT NULL DEFAULT 0 CHECK(reserved_quantity>=0 AND reserved_quantity<=quantity);
ALTER TABLE app.handling_units ADD COLUMN reserved_quantity numeric(20,8) NOT NULL DEFAULT 0 CHECK(reserved_quantity>=0 AND reserved_quantity<'Infinity'::numeric);
CREATE TABLE app.stock_reservations (
 id uuid PRIMARY KEY,company_id uuid NOT NULL REFERENCES app.companies,item_id uuid NOT NULL,owner_id uuid NOT NULL,location_id uuid NOT NULL,unit_id uuid NOT NULL,handling_unit_id uuid,
 quantity numeric(20,8) NOT NULL CHECK(quantity>0 AND quantity<'Infinity'::numeric),active boolean NOT NULL DEFAULT true,
 reference text NOT NULL CHECK(length(trim(reference)) BETWEEN 1 AND 160),reason text NOT NULL CHECK(length(trim(reason)) BETWEEN 3 AND 1000),snapshot jsonb NOT NULL,
 created_by uuid NOT NULL REFERENCES app.profiles,created_at timestamptz NOT NULL, released_at timestamptz,
 UNIQUE(company_id,id),
 FOREIGN KEY(company_id,item_id,owner_id,location_id) REFERENCES app.stock_balances(company_id,item_id,owner_id,location_id),
 FOREIGN KEY(company_id,unit_id) REFERENCES app.units(company_id,id),
 FOREIGN KEY(company_id,handling_unit_id) REFERENCES app.handling_units(company_id,id),
 CHECK(active=(released_at IS NULL))
);
CREATE INDEX reservations_balance ON app.stock_reservations(company_id,item_id,owner_id,location_id) WHERE active;
CREATE INDEX reservations_hu ON app.stock_reservations(company_id,handling_unit_id) WHERE active;
CREATE INDEX reservations_time ON app.stock_reservations(company_id,created_at DESC,id);
CREATE TABLE app.reservation_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),company_id uuid NOT NULL REFERENCES app.companies,idempotency_key uuid NOT NULL,
 kind text NOT NULL CHECK(kind IN ('reserve','release')),reservation_id uuid NOT NULL,
 request jsonb NOT NULL CHECK(jsonb_typeof(request)='object'),reason text NOT NULL CHECK(length(trim(reason)) BETWEEN 3 AND 1000),
 actor_id uuid NOT NULL REFERENCES app.profiles,created_at timestamptz NOT NULL,
 UNIQUE(company_id,idempotency_key),UNIQUE(company_id,reservation_id,kind),
 FOREIGN KEY(company_id,reservation_id) REFERENCES app.stock_reservations(company_id,id) DEFERRABLE INITIALLY DEFERRED
);
CREATE INDEX reservation_events_history ON app.reservation_events(company_id,reservation_id,created_at,id);
ALTER TABLE app.stock_reservations ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.reservation_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY read ON app.stock_reservations FOR SELECT TO app_runtime USING(company_id=app.company_id() AND app.allowed('inventory.read'));
CREATE POLICY read ON app.reservation_events FOR SELECT TO app_runtime USING(company_id=app.company_id() AND app.allowed('inventory.read'));
CREATE POLICY write ON app.reservation_events FOR INSERT TO app_runtime WITH CHECK(company_id=app.company_id() AND app.allowed('inventory.read') AND app.allowed('inventory.reserve'));
REVOKE ALL ON app.stock_reservations,app.reservation_events FROM PUBLIC,anon,authenticated;
GRANT SELECT ON app.stock_reservations,app.reservation_events TO app_runtime;
GRANT INSERT(company_id,idempotency_key,kind,reservation_id,request,reason) ON app.reservation_events TO app_runtime;
CREATE TRIGGER immutable BEFORE UPDATE OR DELETE ON app.reservation_events FOR EACH ROW EXECUTE FUNCTION app_private.inventory_immutable();
CREATE FUNCTION app_private.prepare_reservation() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF NEW.company_id IS DISTINCT FROM app.company_id() OR NOT app.session_active() OR EXISTS(SELECT 1 FROM app.revoked_sessions WHERE session_id=nullif(current_setting('app.session_id',true),'')::uuid) OR NOT app.allowed('inventory.read') OR NOT app.allowed('inventory.reserve') THEN RAISE EXCEPTION 'Permission denied' USING ERRCODE='42501'; END IF;
 NEW.actor_id:=app.actor_id();NEW.created_at:=clock_timestamp();RETURN NEW;
END $$;
CREATE TRIGGER prepare BEFORE INSERT ON app.reservation_events FOR EACH ROW EXECUTE FUNCTION app_private.prepare_reservation();
CREATE FUNCTION app_private.post_reservation() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE r app.stock_reservations; b app.stock_balances; h app.handling_units; d app.production_deliveries; i app.items; o app.stock_owners; l app.locations; u app.units; q numeric; allocated numeric; loose_reserved numeric;
BEGIN
 IF NEW.kind='release' THEN
  IF NEW.request<>'{}'::jsonb THEN RAISE EXCEPTION 'Invalid release' USING ERRCODE='23514'; END IF;
  SELECT * INTO r FROM app.stock_reservations WHERE company_id=NEW.company_id AND id=NEW.reservation_id FOR UPDATE;
  IF r.id IS NULL OR NOT r.active THEN RAISE EXCEPTION 'Active reservation required' USING ERRCODE='23514'; END IF;
  UPDATE app.stock_reservations SET active=false,released_at=NEW.created_at WHERE id=r.id;
  IF r.handling_unit_id IS NOT NULL THEN UPDATE app.handling_units SET reserved_quantity=reserved_quantity-r.quantity WHERE company_id=r.company_id AND id=r.handling_unit_id; END IF;
  UPDATE app.stock_balances SET reserved_quantity=reserved_quantity-r.quantity WHERE company_id=r.company_id AND item_id=r.item_id AND owner_id=r.owner_id AND location_id=r.location_id;
  RETURN NEW;
 END IF;
 IF NOT(NEW.request ?& ARRAY['item_id','owner_id','location_id','quantity','reference','handling_unit_id']) OR NEW.request-ARRAY['item_id','owner_id','location_id','quantity','reference','handling_unit_id']<>'{}'::jsonb OR jsonb_typeof(NEW.request->'quantity')<>'string' OR (NEW.request->>'quantity')!~'^(0|[1-9][0-9]{0,11})(\.[0-9]{1,8})?$' OR jsonb_typeof(NEW.request->'reference')<>'string' OR length(trim(NEW.request->>'reference')) NOT BETWEEN 1 AND 160 THEN RAISE EXCEPTION 'Invalid reservation' USING ERRCODE='23514'; END IF;
 q:=(NEW.request->>'quantity')::numeric;
 SELECT * INTO i FROM app.items WHERE company_id=NEW.company_id AND id=(NEW.request->>'item_id')::uuid AND active FOR SHARE;
 SELECT * INTO o FROM app.stock_owners WHERE company_id=NEW.company_id AND id=(NEW.request->>'owner_id')::uuid AND active FOR SHARE;
 SELECT * INTO l FROM app.locations WHERE company_id=NEW.company_id AND id=(NEW.request->>'location_id')::uuid AND active AND is_storage FOR SHARE;
 SELECT * INTO u FROM app.units WHERE company_id=NEW.company_id AND id=i.unit_id AND active FOR SHARE;
 IF i.id IS NULL OR o.id IS NULL OR l.id IS NULL OR u.id IS NULL OR q<=0 OR (u.dimension IN ('count','package') AND q<>trunc(q)) THEN RAISE EXCEPTION 'Active references and valid quantity required' USING ERRCODE='23514'; END IF;
 IF NEW.request->>'handling_unit_id' IS NOT NULL THEN
  IF NOT app.allowed('production.read') THEN RAISE EXCEPTION 'Permission denied' USING ERRCODE='42501'; END IF;
  SELECT * INTO h FROM app.handling_units WHERE company_id=NEW.company_id AND id=(NEW.request->>'handling_unit_id')::uuid FOR UPDATE;
  SELECT * INTO d FROM app.production_deliveries WHERE company_id=NEW.company_id AND id=h.delivery_id;
  IF h.id IS NULL OR NOT h.active OR h.location_id<>l.id OR d.owner_id<>o.id OR d.snapshot->'product'->>'id' IS DISTINCT FROM i.id::text OR h.reserved_quantity+q>d.quantity THEN RAISE EXCEPTION 'Insufficient matching pallet stock' USING ERRCODE='23514'; END IF;
 END IF;
 SELECT * INTO b FROM app.stock_balances WHERE company_id=NEW.company_id AND item_id=i.id AND owner_id=o.id AND location_id=l.id FOR UPDATE;
 IF b.company_id IS NULL OR b.unit_id<>u.id OR b.quantity-b.reserved_quantity<q THEN RAISE EXCEPTION 'Insufficient available stock' USING ERRCODE='23514'; END IF;
 IF h.id IS NULL THEN
  SELECT coalesce(sum(pd.quantity),0) INTO allocated FROM app.handling_units hu JOIN app.production_deliveries pd ON pd.company_id=hu.company_id AND pd.id=hu.delivery_id WHERE hu.company_id=NEW.company_id AND hu.active AND hu.location_id=l.id AND pd.owner_id=o.id AND pd.snapshot->'product'->>'id'=i.id::text;
  SELECT coalesce(sum(quantity),0) INTO loose_reserved FROM app.stock_reservations WHERE company_id=NEW.company_id AND item_id=i.id AND owner_id=o.id AND location_id=l.id AND active AND handling_unit_id IS NULL;
  IF b.quantity-allocated-loose_reserved<q THEN RAISE EXCEPTION 'Select identified pallet or unallocated stock' USING ERRCODE='23514'; END IF;
 END IF;
 INSERT INTO app.stock_reservations(id,company_id,item_id,owner_id,location_id,unit_id,handling_unit_id,quantity,reference,reason,snapshot,created_by,created_at)
 VALUES(NEW.reservation_id,NEW.company_id,i.id,o.id,l.id,u.id,h.id,q,NEW.request->>'reference',NEW.reason,jsonb_build_object('item',jsonb_build_object('code',i.code,'name',i.name),'owner',jsonb_build_object('code',o.code,'name',o.name),'location',jsonb_build_object('code',l.code,'name',l.name),'unit',jsonb_build_object('code',u.code,'symbol',u.symbol),'handling_unit_code',h.code),NEW.actor_id,NEW.created_at);
 IF h.id IS NOT NULL THEN UPDATE app.handling_units SET reserved_quantity=reserved_quantity+q WHERE company_id=NEW.company_id AND id=h.id; END IF;
 UPDATE app.stock_balances SET reserved_quantity=reserved_quantity+q WHERE company_id=NEW.company_id AND item_id=i.id AND owner_id=o.id AND location_id=l.id;
 RETURN NEW;
END $$;
CREATE TRIGGER post AFTER INSERT ON app.reservation_events FOR EACH ROW EXECUTE FUNCTION app_private.post_reservation();
-- Every physical debit, including corrections, production and reversals, protects loose reservations.
CREATE OR REPLACE FUNCTION app_private.protect_identified_stock() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE allocated numeric; reserved numeric;
BEGIN
 SELECT coalesce(sum(d.quantity),0) INTO allocated FROM app.handling_units h JOIN app.production_deliveries d ON d.company_id=h.company_id AND d.id=h.delivery_id WHERE h.company_id=NEW.company_id AND h.active AND h.location_id=NEW.location_id AND d.owner_id=NEW.owner_id AND d.snapshot->'product'->>'id'=NEW.item_id::text;
 SELECT coalesce(sum(quantity),0) INTO reserved FROM app.stock_reservations WHERE company_id=NEW.company_id AND item_id=NEW.item_id AND owner_id=NEW.owner_id AND location_id=NEW.location_id AND active AND handling_unit_id IS NULL;
 IF NEW.quantity<allocated+reserved THEN RAISE EXCEPTION 'Identified or reserved stock is protected' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE FUNCTION app_private.protect_reserved_pallet() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
 IF OLD.reserved_quantity>0 AND (NEW.location_id IS DISTINCT FROM OLD.location_id OR NEW.active IS DISTINCT FROM OLD.active) THEN RAISE EXCEPTION 'Release pallet reservations before moving or reversing' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER reserved_pallet BEFORE UPDATE ON app.handling_units FOR EACH ROW EXECUTE FUNCTION app_private.protect_reserved_pallet();
REVOKE ALL ON FUNCTION app_private.prepare_reservation(),app_private.post_reservation(),app_private.protect_reserved_pallet() FROM PUBLIC,anon,authenticated,app_runtime;
RESET ROLE;
COMMIT;
