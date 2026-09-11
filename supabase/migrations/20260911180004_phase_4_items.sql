-- Phase 4: catalog definitions only, never inventory balances or business seeds.
BEGIN;
SET LOCAL ROLE app_owner;
CREATE TABLE app.items (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 company_id uuid NOT NULL REFERENCES app.companies(id),
 kind text NOT NULL CHECK(kind IN ('product','material','packaging')),
 code text NOT NULL CHECK(length(code) BETWEEN 1 AND 60 AND code=trim(code)),
 name text NOT NULL CHECK(length(name) BETWEEN 1 AND 160 AND name=trim(name)),
 active boolean NOT NULL DEFAULT true,
 description text NOT NULL DEFAULT '' CHECK(length(description)<=4000),
 notes text NOT NULL DEFAULT '' CHECK(length(notes)<=4000),
 version integer NOT NULL DEFAULT 1 CHECK(version>0),
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 photo_key text CHECK(photo_key IS NULL OR photo_key ~ ('^'||company_id::text||'/'||id::text||'/[0-9a-f-]{36}\.(jpg|png)$')),
 unit_id uuid, customer_id uuid, supplier_id uuid, product_group_id uuid,
 material_type_id uuid, standard_machine_id uuid,
 supplier_code text NOT NULL DEFAULT '' CHECK(length(supplier_code)<=100),
 color text NOT NULL DEFAULT '' CHECK(length(color)<=120),
 production_notes text NOT NULL DEFAULT '' CHECK(length(production_notes)<=4000),
 lead_time_days integer CHECK(lead_time_days BETWEEN 0 AND 3650),
 cavities integer CHECK(cavities BETWEEN 1 AND 100000),
 cycle_time_seconds numeric(20,8) CHECK(cycle_time_seconds>0 AND cycle_time_seconds<'Infinity'::numeric),
 UNIQUE(company_id,id),
 FOREIGN KEY(company_id,unit_id) REFERENCES app.units(company_id,id),
 FOREIGN KEY(company_id,customer_id) REFERENCES app.customers(company_id,id),
 FOREIGN KEY(company_id,supplier_id) REFERENCES app.suppliers(company_id,id),
 FOREIGN KEY(company_id,product_group_id) REFERENCES app.product_groups(company_id,id),
 FOREIGN KEY(company_id,material_type_id) REFERENCES app.material_types(company_id,id),
 FOREIGN KEY(company_id,standard_machine_id) REFERENCES app.machines(company_id,id),
 CHECK(kind='product' OR (customer_id IS NULL AND standard_machine_id IS NULL AND cavities IS NULL AND cycle_time_seconds IS NULL AND production_notes='')),
 CHECK(kind<>'product' OR (material_type_id IS NULL AND supplier_id IS NULL AND supplier_code='' AND lead_time_days IS NULL)),
 minimum_stock numeric(20,8) CHECK(minimum_stock>=0 AND minimum_stock<'Infinity'::numeric),
 desired_stock numeric(20,8) CHECK(desired_stock>=0 AND desired_stock<'Infinity'::numeric),
 maximum_stock numeric(20,8) CHECK(maximum_stock>=0 AND maximum_stock<'Infinity'::numeric),
 reorder_level numeric(20,8) CHECK(reorder_level>=0 AND reorder_level<'Infinity'::numeric),
 standard_order_quantity numeric(20,8) CHECK(standard_order_quantity>=0 AND standard_order_quantity<'Infinity'::numeric),
 quantity_per_pallet numeric(20,8) CHECK(quantity_per_pallet>=0 AND quantity_per_pallet<'Infinity'::numeric),
 CHECK(unit_id IS NOT NULL OR (minimum_stock IS NULL AND desired_stock IS NULL AND maximum_stock IS NULL AND reorder_level IS NULL AND standard_order_quantity IS NULL AND quantity_per_pallet IS NULL)),
 CHECK(desired_stock IS NULL OR minimum_stock IS NULL OR desired_stock>=minimum_stock),
 CHECK(maximum_stock IS NULL OR minimum_stock IS NULL OR maximum_stock>=minimum_stock),
 CHECK(maximum_stock IS NULL OR desired_stock IS NULL OR maximum_stock>=desired_stock)
);
CREATE UNIQUE INDEX items_company_code ON app.items(company_id,lower(code));
CREATE INDEX items_list ON app.items(company_id,kind,active,code,id);
CREATE INDEX items_customer ON app.items(company_id,customer_id);
CREATE INDEX items_supplier ON app.items(company_id,supplier_id);
CREATE INDEX items_group ON app.items(company_id,product_group_id);
ALTER TABLE app.items ENABLE ROW LEVEL SECURITY;
CREATE POLICY items_read ON app.items FOR SELECT TO app_runtime USING(company_id=app.company_id() AND app.allowed('masterdata.read'));
CREATE POLICY items_insert ON app.items FOR INSERT TO app_runtime WITH CHECK(company_id=app.company_id() AND app.allowed('masterdata.read') AND app.allowed('masterdata.manage'));
CREATE POLICY items_update ON app.items FOR UPDATE TO app_runtime
 USING(company_id=app.company_id() AND app.allowed('masterdata.read') AND app.allowed('masterdata.manage'))
 WITH CHECK(company_id=app.company_id() AND app.allowed('masterdata.read') AND app.allowed('masterdata.manage'));
GRANT SELECT, INSERT ON app.items TO app_runtime;
GRANT UPDATE(photo_key,code,name,active,notes,version,description,unit_id,customer_id,supplier_id,supplier_code,product_group_id,material_type_id,standard_machine_id,color,minimum_stock,desired_stock,maximum_stock,reorder_level,standard_order_quantity,quantity_per_pallet,lead_time_days,cycle_time_seconds,cavities,production_notes) ON app.items TO app_runtime;
-- Unit cannot be silently reinterpreted once assigned; kind is immutable.
CREATE FUNCTION app_private.validate_item() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$
DECLARE field text; target text; reference uuid;
BEGIN
 IF TG_OP='UPDATE' AND (NEW.kind<>OLD.kind OR (OLD.unit_id IS NOT NULL AND NEW.unit_id IS DISTINCT FROM OLD.unit_id)) THEN
  RAISE EXCEPTION 'Item kind and assigned unit are immutable' USING ERRCODE='23514';
 END IF;
 FOR field,target IN SELECT * FROM (VALUES ('unit_id','units'),('customer_id','customers'),('supplier_id','suppliers'),('product_group_id','product_groups'),('material_type_id','material_types'),('standard_machine_id','machines')) AS refs(field,target) LOOP
  reference:=(to_jsonb(NEW)->>field)::uuid;
  IF reference IS NOT NULL AND (TG_OP='INSERT' OR (to_jsonb(OLD)->>field)::uuid IS DISTINCT FROM reference) THEN
   EXECUTE format('SELECT id FROM app.%I WHERE company_id=$1 AND id=$2 AND active FOR SHARE',target) INTO reference USING NEW.company_id,reference;
   IF reference IS NULL THEN RAISE EXCEPTION 'Active same-company reference required' USING ERRCODE='23514'; END IF;
  END IF;
 END LOOP;
 RETURN NEW;
END $$;
CREATE TRIGGER items_validate BEFORE INSERT OR UPDATE ON app.items FOR EACH ROW EXECUTE FUNCTION app_private.validate_item();
CREATE TRIGGER items_audit BEFORE INSERT OR UPDATE ON app.items FOR EACH ROW EXECUTE FUNCTION app_private.audit_masterdata();
RESET ROLE;
COMMIT;
