-- Immutable recipe revisions; no stock, orders, locations or hosted fixtures.
BEGIN;
SET LOCAL ROLE app_owner;
CREATE TABLE app.recipes (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid NOT NULL REFERENCES app.companies(id),
 product_id uuid NOT NULL, kind text NOT NULL CHECK(kind IN ('bom','packing')),
 name text NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 160), active boolean NOT NULL DEFAULT true,
 is_default boolean NOT NULL DEFAULT false, current_revision_id uuid,
 version integer NOT NULL DEFAULT 1 CHECK(version>0), notes text NOT NULL DEFAULT '' CHECK(length(notes)<=4000),
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(company_id,id), FOREIGN KEY(company_id,product_id) REFERENCES app.items(company_id,id),
 CHECK(NOT is_default OR (active AND current_revision_id IS NOT NULL))
);
CREATE UNIQUE INDEX recipes_default ON app.recipes(company_id,product_id,kind) WHERE is_default;
CREATE UNIQUE INDEX recipes_name ON app.recipes(company_id,product_id,kind,lower(name));
CREATE INDEX recipes_list ON app.recipes(company_id,product_id,kind,id);
CREATE TABLE app.recipe_revisions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid NOT NULL, recipe_id uuid NOT NULL,
 revision integer NOT NULL CHECK(revision>0), base_quantity numeric(20,8) NOT NULL DEFAULT 1 CHECK(base_quantity>0 AND base_quantity<'Infinity'::numeric),
 pallet_type_id uuid, notes text NOT NULL DEFAULT '' CHECK(length(notes)<=4000),
 snapshot jsonb NOT NULL DEFAULT '{}', sealed boolean NOT NULL DEFAULT false,
 created_at timestamptz NOT NULL DEFAULT now(), created_by uuid NOT NULL DEFAULT app.actor_id() REFERENCES app.profiles(id),
 UNIQUE(company_id,id), UNIQUE(company_id,recipe_id,id), UNIQUE(company_id,recipe_id,revision),
 FOREIGN KEY(company_id,recipe_id) REFERENCES app.recipes(company_id,id),
 FOREIGN KEY(company_id,pallet_type_id) REFERENCES app.pallet_types(company_id,id)
);
ALTER TABLE app.recipes ADD FOREIGN KEY(company_id,id,current_revision_id) REFERENCES app.recipe_revisions(company_id,recipe_id,id);
CREATE TABLE app.recipe_lines (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid NOT NULL, revision_id uuid NOT NULL,
 component_id uuid NOT NULL, kind text NOT NULL CHECK(kind IN ('component','container','accessory')),
 level integer NOT NULL DEFAULT 0 CHECK(level BETWEEN 0 AND 15),
 quantity numeric(20,8) NOT NULL CHECK(quantity>0 AND quantity<'Infinity'::numeric), snapshot jsonb NOT NULL DEFAULT '{}',
 UNIQUE(company_id,revision_id,component_id),
 FOREIGN KEY(company_id,revision_id) REFERENCES app.recipe_revisions(company_id,id),
 FOREIGN KEY(company_id,component_id) REFERENCES app.items(company_id,id)
);
CREATE UNIQUE INDEX recipe_container_level ON app.recipe_lines(company_id,revision_id,level) WHERE kind='container';
CREATE INDEX recipe_component ON app.recipe_lines(company_id,component_id);
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['recipes','recipe_revisions','recipe_lines'] LOOP
  EXECUTE format('ALTER TABLE app.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('CREATE POLICY read ON app.%I FOR SELECT TO app_runtime USING(company_id=app.company_id() AND app.allowed(''masterdata.read''))',t);
  EXECUTE format('CREATE POLICY write ON app.%I FOR INSERT TO app_runtime WITH CHECK(company_id=app.company_id() AND app.allowed(''masterdata.read'') AND app.allowed(''masterdata.manage''))',t);
  EXECUTE format('GRANT SELECT,INSERT ON app.%I TO app_runtime',t);
 END LOOP;
 FOREACH t IN ARRAY ARRAY['recipes','recipe_revisions'] LOOP
  EXECUTE format('CREATE POLICY change ON app.%I FOR UPDATE TO app_runtime USING(company_id=app.company_id() AND app.allowed(''masterdata.read'') AND app.allowed(''masterdata.manage'')) WITH CHECK(company_id=app.company_id() AND app.allowed(''masterdata.read'') AND app.allowed(''masterdata.manage''))',t);
 END LOOP;
END $$;
GRANT UPDATE(name,active,is_default,current_revision_id,version,notes) ON app.recipes TO app_runtime;
GRANT UPDATE(sealed) ON app.recipe_revisions TO app_runtime;
-- Every change for the same product serializes on its row. API transactions are serializable.
CREATE FUNCTION app_private.validate_recipe() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$
DECLARE p app.items; BEGIN
 IF NEW.company_id IS DISTINCT FROM app.company_id() OR NOT app.allowed('masterdata.read') OR NOT app.allowed('masterdata.manage') THEN RAISE EXCEPTION 'Permission denied' USING ERRCODE='42501'; END IF;
 SELECT * INTO p FROM app.items WHERE company_id=NEW.company_id AND id=NEW.product_id FOR UPDATE;
 IF p.id IS NULL OR p.kind<>'product' THEN RAISE EXCEPTION 'Product required' USING ERRCODE='23514'; END IF;
 IF TG_OP='UPDATE' AND (NEW.id<>OLD.id OR NEW.company_id<>OLD.company_id OR NEW.product_id<>OLD.product_id OR NEW.kind<>OLD.kind) THEN RAISE EXCEPTION 'Immutable identity' USING ERRCODE='23514'; END IF;
 IF NEW.current_revision_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM app.recipe_revisions WHERE company_id=NEW.company_id AND recipe_id=NEW.id AND id=NEW.current_revision_id AND sealed) THEN RAISE EXCEPTION 'Sealed revision required' USING ERRCODE='23514'; END IF;
 IF NEW.active AND NEW.current_revision_id IS NOT NULL AND EXISTS(
  SELECT 1 FROM app.recipe_lines a JOIN app.recipe_lines b ON b.company_id=a.company_id AND b.component_id=a.component_id
  JOIN app.recipes r ON r.company_id=b.company_id AND r.current_revision_id=b.revision_id
  WHERE a.company_id=NEW.company_id AND a.revision_id=NEW.current_revision_id AND r.product_id=NEW.product_id AND r.kind<>NEW.kind AND r.active
 ) THEN RAISE EXCEPTION 'Component must have one consumption owner: BOM or packing' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER recipes_validate BEFORE INSERT OR UPDATE ON app.recipes FOR EACH ROW EXECUTE FUNCTION app_private.validate_recipe();
CREATE TRIGGER recipes_audit BEFORE INSERT OR UPDATE ON app.recipes FOR EACH ROW EXECUTE FUNCTION app_private.audit_masterdata();
CREATE FUNCTION app_private.validate_recipe_line() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$
DECLARE v app.recipe_revisions; r app.recipes; i app.items; u app.units; BEGIN
 IF NEW.company_id IS DISTINCT FROM app.company_id() OR NOT app.allowed('masterdata.read') OR NOT app.allowed('masterdata.manage') THEN RAISE EXCEPTION 'Permission denied' USING ERRCODE='42501'; END IF;
 SELECT * INTO v FROM app.recipe_revisions WHERE company_id=NEW.company_id AND id=NEW.revision_id FOR UPDATE;
 IF v.id IS NULL OR v.sealed THEN RAISE EXCEPTION 'Revision is immutable' USING ERRCODE='23514'; END IF;
 SELECT * INTO r FROM app.recipes WHERE company_id=v.company_id AND id=v.recipe_id;
 SELECT * INTO i FROM app.items WHERE company_id=NEW.company_id AND id=NEW.component_id AND active FOR SHARE;
 SELECT * INTO u FROM app.units WHERE company_id=NEW.company_id AND id=i.unit_id AND active FOR SHARE;
 IF i.id IS NULL OR u.id IS NULL OR i.id=r.product_id THEN RAISE EXCEPTION 'Active component with stock unit required' USING ERRCODE='23514'; END IF;
 IF r.kind='bom' AND (NEW.kind<>'component' OR NEW.level<>0) OR r.kind='packing' AND (NEW.kind='component' OR i.kind<>'packaging' OR u.dimension NOT IN ('count','package')) THEN RAISE EXCEPTION 'Invalid component usage' USING ERRCODE='23514'; END IF;
 IF r.kind='packing' AND (NEW.kind='accessory' OR NEW.level>0) AND NEW.quantity<>trunc(NEW.quantity) THEN RAISE EXCEPTION 'Whole containers required' USING ERRCODE='23514'; END IF;
 NEW.snapshot:=jsonb_build_object('id',i.id,'code',i.code,'name',i.name,'kind',i.kind,'unit_id',u.id,'unit',u.symbol,'dimension',u.dimension,'consumption_owner',r.kind);
 RETURN NEW;
END $$;
CREATE TRIGGER recipe_lines_validate BEFORE INSERT ON app.recipe_lines FOR EACH ROW EXECUTE FUNCTION app_private.validate_recipe_line();
CREATE FUNCTION app_private.validate_recipe_revision() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE r app.recipes; p app.items; u app.units; pal app.pallet_types; n integer; top integer; BEGIN
 IF NEW.company_id IS DISTINCT FROM app.company_id() OR NOT app.allowed('masterdata.read') OR NOT app.allowed('masterdata.manage') THEN RAISE EXCEPTION 'Permission denied' USING ERRCODE='42501'; END IF;
 SELECT * INTO r FROM app.recipes WHERE company_id=NEW.company_id AND id=NEW.recipe_id;
 SELECT * INTO p FROM app.items WHERE company_id=r.company_id AND id=r.product_id FOR UPDATE;
 IF TG_OP='INSERT' THEN
  SELECT * INTO u FROM app.units WHERE company_id=p.company_id AND id=p.unit_id AND active FOR SHARE;
  IF p.id IS NULL OR NOT p.active OR u.id IS NULL OR NEW.sealed OR NEW.created_by IS DISTINCT FROM app.actor_id() THEN RAISE EXCEPTION 'Active product with unit required' USING ERRCODE='23514'; END IF;
  IF NEW.pallet_type_id IS NOT NULL THEN
   SELECT * INTO pal FROM app.pallet_types WHERE company_id=NEW.company_id AND id=NEW.pallet_type_id AND active FOR SHARE;
   IF pal.id IS NULL OR r.kind<>'packing' THEN RAISE EXCEPTION 'Active pallet type required' USING ERRCODE='23514'; END IF;
  END IF;
  IF r.kind='packing' AND NEW.base_quantity<>1 THEN RAISE EXCEPTION 'Packing base must be one' USING ERRCODE='23514'; END IF;
  NEW.snapshot:=jsonb_build_object('product_id',p.id,'code',p.code,'name',p.name,'unit_id',u.id,'unit',u.symbol,'dimension',u.dimension,'kind',r.kind,'recipe_name',r.name,'pallet_type',CASE WHEN pal.id IS NULL THEN NULL ELSE jsonb_build_object('id',pal.id,'code',pal.code,'name',pal.name) END);
 ELSE
  IF OLD.sealed OR NOT NEW.sealed OR (to_jsonb(NEW)-'sealed')<>(to_jsonb(OLD)-'sealed') THEN RAISE EXCEPTION 'Immutable revision' USING ERRCODE='23514'; END IF;
  SELECT count(*) INTO n FROM app.recipe_lines WHERE company_id=NEW.company_id AND revision_id=NEW.id;
  IF n NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'One to 100 lines required' USING ERRCODE='23514'; END IF;
  IF r.kind='packing' THEN
   SELECT count(*),max(level) INTO n,top FROM app.recipe_lines WHERE company_id=NEW.company_id AND revision_id=NEW.id AND kind='container';
   IF n=0 OR n<>top+1 OR EXISTS(SELECT 1 FROM app.recipe_lines WHERE company_id=NEW.company_id AND revision_id=NEW.id AND level>top) THEN RAISE EXCEPTION 'Contiguous container levels required' USING ERRCODE='23514'; END IF;
   IF NEW.snapshot->>'dimension'='count' AND EXISTS(SELECT 1 FROM app.recipe_lines WHERE company_id=NEW.company_id AND revision_id=NEW.id AND kind='container' AND level=0 AND quantity<>trunc(quantity)) THEN RAISE EXCEPTION 'Whole product units required' USING ERRCODE='23514'; END IF;
  END IF;
  INSERT INTO app.masterdata_audit(company_id,actor_id,entity_type,entity_id,action,before_value,after_value)
   VALUES(NEW.company_id,app.actor_id(),'recipe_revisions',NEW.id,'INSERT',NULL,to_jsonb(NEW)||jsonb_build_object('lines',(SELECT jsonb_agg(to_jsonb(l) ORDER BY level,kind,id) FROM app.recipe_lines l WHERE company_id=NEW.company_id AND revision_id=NEW.id)));
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER recipe_revisions_validate BEFORE INSERT OR UPDATE ON app.recipe_revisions FOR EACH ROW EXECUTE FUNCTION app_private.validate_recipe_revision();
-- A partially written revision cannot survive transaction commit.
CREATE FUNCTION app_private.require_sealed_revision() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM app.recipe_revisions WHERE company_id=NEW.company_id AND id=NEW.id AND sealed) THEN RAISE EXCEPTION 'Unsealed revision' USING ERRCODE='23514'; END IF; RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER recipe_revisions_sealed AFTER INSERT ON app.recipe_revisions DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION app_private.require_sealed_revision();
RESET ROLE;
COMMIT;
