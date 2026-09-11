-- Phase 6 masterdata only; no inventory balances, movements or business fixtures.
BEGIN;
SET LOCAL ROLE app_owner;
CREATE TABLE app.locations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid NOT NULL REFERENCES app.companies(id),
 parent_id uuid, code text NOT NULL CHECK(length(code) BETWEEN 1 AND 60 AND code=trim(code)),
 name text NOT NULL CHECK(length(name) BETWEEN 1 AND 160 AND name=trim(name)),
 location_type text NOT NULL DEFAULT '' CHECK(length(location_type)<=80),
 active boolean NOT NULL DEFAULT true, is_storage boolean NOT NULL DEFAULT true,
 notes text NOT NULL DEFAULT '' CHECK(length(notes)<=4000), version integer NOT NULL DEFAULT 1 CHECK(version>0),
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(company_id,id), FOREIGN KEY(company_id,parent_id) REFERENCES app.locations(company_id,id),
 CHECK(parent_id IS DISTINCT FROM id)
);
CREATE UNIQUE INDEX locations_code ON app.locations(company_id,lower(code));
CREATE INDEX locations_parent ON app.locations(company_id,parent_id,code,id);
CREATE INDEX locations_list ON app.locations(company_id,active,is_storage,code,id);
ALTER TABLE app.locations ENABLE ROW LEVEL SECURITY;
CREATE POLICY locations_read ON app.locations FOR SELECT TO app_runtime USING(company_id=app.company_id() AND app.allowed('masterdata.read'));
CREATE POLICY locations_insert ON app.locations FOR INSERT TO app_runtime WITH CHECK(company_id=app.company_id() AND app.allowed('masterdata.read') AND app.allowed('masterdata.manage'));
CREATE POLICY locations_update ON app.locations FOR UPDATE TO app_runtime
 USING(company_id=app.company_id() AND app.allowed('masterdata.read') AND app.allowed('masterdata.manage'))
 WITH CHECK(company_id=app.company_id() AND app.allowed('masterdata.read') AND app.allowed('masterdata.manage'));
GRANT SELECT,INSERT ON app.locations TO app_runtime;
GRANT UPDATE(parent_id,code,name,location_type,active,is_storage,notes,version) ON app.locations TO app_runtime;
-- A private write gate makes competing hierarchy edits conflict even under snapshot isolation.
-- This is infrastructure, populated only when a company edits its locations.
CREATE TABLE app_private.location_tree_locks (
 company_id uuid PRIMARY KEY REFERENCES app.companies(id), revision bigint NOT NULL DEFAULT 1
);
ALTER TABLE app_private.location_tree_locks ENABLE ROW LEVEL SECURITY;
CREATE FUNCTION app_private.validate_location() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE p app.locations; ancestors uuid[]; ancestor_count integer:=0; height integer:=0;
BEGIN
 IF NEW.company_id IS DISTINCT FROM app.company_id() OR NOT app.allowed('masterdata.read') OR NOT app.allowed('masterdata.manage') THEN RAISE EXCEPTION 'Permission denied' USING ERRCODE='42501'; END IF;
 INSERT INTO app_private.location_tree_locks(company_id) VALUES(NEW.company_id)
 ON CONFLICT(company_id) DO UPDATE SET revision=app_private.location_tree_locks.revision+1;
 IF TG_OP='UPDATE' AND (NEW.id<>OLD.id OR NEW.company_id<>OLD.company_id) THEN RAISE EXCEPTION 'Immutable identity' USING ERRCODE='23514'; END IF;
 IF NEW.parent_id IS NOT NULL THEN
  SELECT * INTO p FROM app.locations WHERE company_id=NEW.company_id AND id=NEW.parent_id;
  IF p.id IS NULL OR (NEW.active AND NOT p.active) THEN RAISE EXCEPTION 'Valid same-company parent required' USING ERRCODE='23514'; END IF;
  WITH RECURSIVE chain AS (
   SELECT id,parent_id,1 AS depth FROM app.locations WHERE company_id=NEW.company_id AND id=NEW.parent_id
   UNION ALL SELECT l.id,l.parent_id,c.depth+1 FROM app.locations l JOIN chain c ON l.id=c.parent_id WHERE l.company_id=NEW.company_id AND c.depth<33
  ) SELECT array_agg(id),count(*) INTO ancestors,ancestor_count FROM chain;
  IF NEW.id=ANY(ancestors) THEN RAISE EXCEPTION 'Location cycle' USING ERRCODE='23514'; END IF;
 END IF;
 IF TG_OP='UPDATE' THEN
  WITH RECURSIVE descendants AS (
   SELECT id,0 AS depth FROM app.locations WHERE company_id=NEW.company_id AND id=NEW.id
   UNION ALL SELECT l.id,d.depth+1 FROM app.locations l JOIN descendants d ON l.parent_id=d.id WHERE l.company_id=NEW.company_id AND d.depth<33
  ) SELECT coalesce(max(depth),0) INTO height FROM descendants;
 END IF;
 IF ancestor_count+1+height>32 THEN RAISE EXCEPTION 'Location depth exceeds 32' USING ERRCODE='23514'; END IF;
 IF NOT NEW.active AND EXISTS(SELECT 1 FROM app.locations WHERE company_id=NEW.company_id AND parent_id=NEW.id AND active) THEN RAISE EXCEPTION 'Deactivate or relocate active children first' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER locations_validate BEFORE INSERT OR UPDATE ON app.locations FOR EACH ROW EXECUTE FUNCTION app_private.validate_location();
CREATE TRIGGER locations_audit BEFORE INSERT OR UPDATE ON app.locations FOR EACH ROW EXECUTE FUNCTION app_private.audit_masterdata();
ALTER TABLE app.items ADD COLUMN standard_location_id uuid,
 ADD FOREIGN KEY(company_id,standard_location_id) REFERENCES app.locations(company_id,id);
CREATE INDEX items_location ON app.items(company_id,standard_location_id);
GRANT UPDATE(standard_location_id) ON app.items TO app_runtime;
ALTER TABLE app.machines ADD COLUMN location_id uuid,
 ADD FOREIGN KEY(company_id,location_id) REFERENCES app.locations(company_id,id);
CREATE INDEX machines_location ON app.machines(company_id,location_id);
GRANT UPDATE(location_id) ON app.machines TO app_runtime;
CREATE FUNCTION app_private.validate_location_reference() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$
DECLARE field text; reference uuid; found_id uuid;
BEGIN
 field:=CASE WHEN TG_TABLE_NAME='items' THEN 'standard_location_id' ELSE 'location_id' END;
 reference:=(to_jsonb(NEW)->>field)::uuid;
 IF reference IS NOT NULL AND (TG_OP='INSERT' OR (to_jsonb(OLD)->>field)::uuid IS DISTINCT FROM reference) THEN
  SELECT id INTO found_id FROM app.locations WHERE company_id=NEW.company_id AND id=reference AND active AND (TG_TABLE_NAME<>'items' OR is_storage) FOR SHARE;
  IF found_id IS NULL THEN RAISE EXCEPTION 'Active same-company location required' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER items_location_validate BEFORE INSERT OR UPDATE ON app.items FOR EACH ROW EXECUTE FUNCTION app_private.validate_location_reference();
CREATE TRIGGER machines_location_validate BEFORE INSERT OR UPDATE ON app.machines FOR EACH ROW EXECUTE FUNCTION app_private.validate_location_reference();
RESET ROLE;
COMMIT;
