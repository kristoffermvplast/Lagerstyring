-- Phase 3: no business data seeds; permissions are technical capabilities.
BEGIN;
SET LOCAL ROLE app_owner;
INSERT INTO app.permissions VALUES ('masterdata.read','Se stamdata og historik'),('masterdata.manage','Oprette og ændre stamdata');
CREATE TABLE app.masterdata_audit (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 company_id uuid NOT NULL REFERENCES app.companies(id),
 actor_id uuid NOT NULL REFERENCES app.profiles(id),
 entity_type text NOT NULL,
 entity_id uuid NOT NULL,
 action text NOT NULL CHECK(action IN ('INSERT','UPDATE')),
 before_value jsonb, after_value jsonb NOT NULL,
 occurred_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX masterdata_audit_entity ON app.masterdata_audit(company_id,entity_type,entity_id,occurred_at DESC,id);
ALTER TABLE app.masterdata_audit ENABLE ROW LEVEL SECURITY;
CREATE POLICY masterdata_audit_read ON app.masterdata_audit FOR SELECT TO app_runtime
 USING(company_id=app.company_id() AND app.allowed('masterdata.read'));
GRANT SELECT ON app.masterdata_audit TO app_runtime;
CREATE FUNCTION app_private.audit_masterdata() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
 SET search_path=pg_catalog AS $$
BEGIN
 IF TG_OP='UPDATE' THEN
  IF NEW.id<>OLD.id OR NEW.company_id<>OLD.company_id OR NEW.created_at<>OLD.created_at OR NEW.version<>OLD.version+1 THEN
   RAISE EXCEPTION 'Immutable identity or invalid version' USING ERRCODE='23514';
  END IF;
 END IF;
 IF app.actor_id() IS NULL THEN RAISE EXCEPTION 'Actor required' USING ERRCODE='42501'; END IF;
 NEW.updated_at:=clock_timestamp();
 INSERT INTO app.masterdata_audit(company_id,actor_id,entity_type,entity_id,action,before_value,after_value)
 VALUES(NEW.company_id,app.actor_id(),TG_TABLE_NAME,NEW.id,TG_OP,CASE WHEN TG_OP='UPDATE' THEN to_jsonb(OLD) ELSE NULL END,to_jsonb(NEW));
 RETURN NEW;
END $$;

CREATE TABLE app.customers (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid NOT NULL REFERENCES app.companies(id),
 code text NOT NULL CHECK(length(trim(code)) BETWEEN 1 AND 60 AND code=trim(code)),
 name text NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 160 AND name=trim(name)),
 active boolean NOT NULL DEFAULT true,
 notes text NOT NULL DEFAULT '' CHECK(length(notes)<=4000),
 version integer NOT NULL DEFAULT 1 CHECK(version>0),
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(company_id,id),
 address text NOT NULL DEFAULT '' CHECK(length(address)<=1000), contact_name text NOT NULL DEFAULT '' CHECK(length(contact_name)<=120), phone text NOT NULL DEFAULT '' CHECK(length(phone)<=60), email text NOT NULL DEFAULT '' CHECK(length(email)<=254)
);
CREATE UNIQUE INDEX customers_company_code ON app.customers(company_id,lower(code));
CREATE INDEX customers_list ON app.customers(company_id,active,code,id);
ALTER TABLE app.customers ENABLE ROW LEVEL SECURITY;
CREATE POLICY customers_read ON app.customers FOR SELECT TO app_runtime
 USING(company_id=app.company_id() AND app.allowed('masterdata.read'));
CREATE POLICY customers_insert ON app.customers FOR INSERT TO app_runtime
 WITH CHECK(company_id=app.company_id() AND app.allowed('masterdata.manage') AND app.allowed('masterdata.read'));
CREATE POLICY customers_update ON app.customers FOR UPDATE TO app_runtime
 USING(company_id=app.company_id() AND app.allowed('masterdata.manage') AND app.allowed('masterdata.read'))
 WITH CHECK(company_id=app.company_id() AND app.allowed('masterdata.manage') AND app.allowed('masterdata.read'));
GRANT SELECT,INSERT ON app.customers TO app_runtime;
GRANT UPDATE(code,name,active,notes,version,address,contact_name,phone,email) ON app.customers TO app_runtime;
CREATE TRIGGER customers_audit BEFORE INSERT OR UPDATE ON app.customers FOR EACH ROW EXECUTE FUNCTION app_private.audit_masterdata();

CREATE TABLE app.suppliers (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid NOT NULL REFERENCES app.companies(id),
 code text NOT NULL CHECK(length(trim(code)) BETWEEN 1 AND 60 AND code=trim(code)),
 name text NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 160 AND name=trim(name)),
 active boolean NOT NULL DEFAULT true,
 notes text NOT NULL DEFAULT '' CHECK(length(notes)<=4000),
 version integer NOT NULL DEFAULT 1 CHECK(version>0),
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(company_id,id),
 address text NOT NULL DEFAULT '' CHECK(length(address)<=1000), contact_name text NOT NULL DEFAULT '' CHECK(length(contact_name)<=120), phone text NOT NULL DEFAULT '' CHECK(length(phone)<=60), email text NOT NULL DEFAULT '' CHECK(length(email)<=254), lead_time_days integer CHECK(lead_time_days BETWEEN 0 AND 3650)
);
CREATE UNIQUE INDEX suppliers_company_code ON app.suppliers(company_id,lower(code));
CREATE INDEX suppliers_list ON app.suppliers(company_id,active,code,id);
ALTER TABLE app.suppliers ENABLE ROW LEVEL SECURITY;
CREATE POLICY suppliers_read ON app.suppliers FOR SELECT TO app_runtime
 USING(company_id=app.company_id() AND app.allowed('masterdata.read'));
CREATE POLICY suppliers_insert ON app.suppliers FOR INSERT TO app_runtime
 WITH CHECK(company_id=app.company_id() AND app.allowed('masterdata.manage') AND app.allowed('masterdata.read'));
CREATE POLICY suppliers_update ON app.suppliers FOR UPDATE TO app_runtime
 USING(company_id=app.company_id() AND app.allowed('masterdata.manage') AND app.allowed('masterdata.read'))
 WITH CHECK(company_id=app.company_id() AND app.allowed('masterdata.manage') AND app.allowed('masterdata.read'));
GRANT SELECT,INSERT ON app.suppliers TO app_runtime;
GRANT UPDATE(code,name,active,notes,version,address,contact_name,phone,email,lead_time_days) ON app.suppliers TO app_runtime;
CREATE TRIGGER suppliers_audit BEFORE INSERT OR UPDATE ON app.suppliers FOR EACH ROW EXECUTE FUNCTION app_private.audit_masterdata();

CREATE TABLE app.product_groups (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid NOT NULL REFERENCES app.companies(id),
 code text NOT NULL CHECK(length(trim(code)) BETWEEN 1 AND 60 AND code=trim(code)),
 name text NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 160 AND name=trim(name)),
 active boolean NOT NULL DEFAULT true,
 notes text NOT NULL DEFAULT '' CHECK(length(notes)<=4000),
 version integer NOT NULL DEFAULT 1 CHECK(version>0),
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(company_id,id)

);
CREATE UNIQUE INDEX product_groups_company_code ON app.product_groups(company_id,lower(code));
CREATE INDEX product_groups_list ON app.product_groups(company_id,active,code,id);
ALTER TABLE app.product_groups ENABLE ROW LEVEL SECURITY;
CREATE POLICY product_groups_read ON app.product_groups FOR SELECT TO app_runtime
 USING(company_id=app.company_id() AND app.allowed('masterdata.read'));
CREATE POLICY product_groups_insert ON app.product_groups FOR INSERT TO app_runtime
 WITH CHECK(company_id=app.company_id() AND app.allowed('masterdata.manage') AND app.allowed('masterdata.read'));
CREATE POLICY product_groups_update ON app.product_groups FOR UPDATE TO app_runtime
 USING(company_id=app.company_id() AND app.allowed('masterdata.manage') AND app.allowed('masterdata.read'))
 WITH CHECK(company_id=app.company_id() AND app.allowed('masterdata.manage') AND app.allowed('masterdata.read'));
GRANT SELECT,INSERT ON app.product_groups TO app_runtime;
GRANT UPDATE(code,name,active,notes,version) ON app.product_groups TO app_runtime;
CREATE TRIGGER product_groups_audit BEFORE INSERT OR UPDATE ON app.product_groups FOR EACH ROW EXECUTE FUNCTION app_private.audit_masterdata();

CREATE TABLE app.machine_types (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid NOT NULL REFERENCES app.companies(id),
 code text NOT NULL CHECK(length(trim(code)) BETWEEN 1 AND 60 AND code=trim(code)),
 name text NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 160 AND name=trim(name)),
 active boolean NOT NULL DEFAULT true,
 notes text NOT NULL DEFAULT '' CHECK(length(notes)<=4000),
 version integer NOT NULL DEFAULT 1 CHECK(version>0),
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(company_id,id)

);
CREATE UNIQUE INDEX machine_types_company_code ON app.machine_types(company_id,lower(code));
CREATE INDEX machine_types_list ON app.machine_types(company_id,active,code,id);
ALTER TABLE app.machine_types ENABLE ROW LEVEL SECURITY;
CREATE POLICY machine_types_read ON app.machine_types FOR SELECT TO app_runtime
 USING(company_id=app.company_id() AND app.allowed('masterdata.read'));
CREATE POLICY machine_types_insert ON app.machine_types FOR INSERT TO app_runtime
 WITH CHECK(company_id=app.company_id() AND app.allowed('masterdata.manage') AND app.allowed('masterdata.read'));
CREATE POLICY machine_types_update ON app.machine_types FOR UPDATE TO app_runtime
 USING(company_id=app.company_id() AND app.allowed('masterdata.manage') AND app.allowed('masterdata.read'))
 WITH CHECK(company_id=app.company_id() AND app.allowed('masterdata.manage') AND app.allowed('masterdata.read'));
GRANT SELECT,INSERT ON app.machine_types TO app_runtime;
GRANT UPDATE(code,name,active,notes,version) ON app.machine_types TO app_runtime;
CREATE TRIGGER machine_types_audit BEFORE INSERT OR UPDATE ON app.machine_types FOR EACH ROW EXECUTE FUNCTION app_private.audit_masterdata();

CREATE TABLE app.material_types (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid NOT NULL REFERENCES app.companies(id),
 code text NOT NULL CHECK(length(trim(code)) BETWEEN 1 AND 60 AND code=trim(code)),
 name text NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 160 AND name=trim(name)),
 active boolean NOT NULL DEFAULT true,
 notes text NOT NULL DEFAULT '' CHECK(length(notes)<=4000),
 version integer NOT NULL DEFAULT 1 CHECK(version>0),
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(company_id,id)

);
CREATE UNIQUE INDEX material_types_company_code ON app.material_types(company_id,lower(code));
CREATE INDEX material_types_list ON app.material_types(company_id,active,code,id);
ALTER TABLE app.material_types ENABLE ROW LEVEL SECURITY;
CREATE POLICY material_types_read ON app.material_types FOR SELECT TO app_runtime
 USING(company_id=app.company_id() AND app.allowed('masterdata.read'));
CREATE POLICY material_types_insert ON app.material_types FOR INSERT TO app_runtime
 WITH CHECK(company_id=app.company_id() AND app.allowed('masterdata.manage') AND app.allowed('masterdata.read'));
CREATE POLICY material_types_update ON app.material_types FOR UPDATE TO app_runtime
 USING(company_id=app.company_id() AND app.allowed('masterdata.manage') AND app.allowed('masterdata.read'))
 WITH CHECK(company_id=app.company_id() AND app.allowed('masterdata.manage') AND app.allowed('masterdata.read'));
GRANT SELECT,INSERT ON app.material_types TO app_runtime;
GRANT UPDATE(code,name,active,notes,version) ON app.material_types TO app_runtime;
CREATE TRIGGER material_types_audit BEFORE INSERT OR UPDATE ON app.material_types FOR EACH ROW EXECUTE FUNCTION app_private.audit_masterdata();

CREATE TABLE app.pallet_types (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid NOT NULL REFERENCES app.companies(id),
 code text NOT NULL CHECK(length(trim(code)) BETWEEN 1 AND 60 AND code=trim(code)),
 name text NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 160 AND name=trim(name)),
 active boolean NOT NULL DEFAULT true,
 notes text NOT NULL DEFAULT '' CHECK(length(notes)<=4000),
 version integer NOT NULL DEFAULT 1 CHECK(version>0),
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(company_id,id)

);
CREATE UNIQUE INDEX pallet_types_company_code ON app.pallet_types(company_id,lower(code));
CREATE INDEX pallet_types_list ON app.pallet_types(company_id,active,code,id);
ALTER TABLE app.pallet_types ENABLE ROW LEVEL SECURITY;
CREATE POLICY pallet_types_read ON app.pallet_types FOR SELECT TO app_runtime
 USING(company_id=app.company_id() AND app.allowed('masterdata.read'));
CREATE POLICY pallet_types_insert ON app.pallet_types FOR INSERT TO app_runtime
 WITH CHECK(company_id=app.company_id() AND app.allowed('masterdata.manage') AND app.allowed('masterdata.read'));
CREATE POLICY pallet_types_update ON app.pallet_types FOR UPDATE TO app_runtime
 USING(company_id=app.company_id() AND app.allowed('masterdata.manage') AND app.allowed('masterdata.read'))
 WITH CHECK(company_id=app.company_id() AND app.allowed('masterdata.manage') AND app.allowed('masterdata.read'));
GRANT SELECT,INSERT ON app.pallet_types TO app_runtime;
GRANT UPDATE(code,name,active,notes,version) ON app.pallet_types TO app_runtime;
CREATE TRIGGER pallet_types_audit BEFORE INSERT OR UPDATE ON app.pallet_types FOR EACH ROW EXECUTE FUNCTION app_private.audit_masterdata();

CREATE TABLE app.units (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid NOT NULL REFERENCES app.companies(id),
 code text NOT NULL CHECK(length(trim(code)) BETWEEN 1 AND 60 AND code=trim(code)),
 name text NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 160 AND name=trim(name)),
 active boolean NOT NULL DEFAULT true,
 notes text NOT NULL DEFAULT '' CHECK(length(notes)<=4000),
 version integer NOT NULL DEFAULT 1 CHECK(version>0),
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(company_id,id),
 symbol text NOT NULL CHECK(length(trim(symbol)) BETWEEN 1 AND 20), dimension text NOT NULL CHECK(dimension IN ('count','mass','length','volume','package'))
);
CREATE UNIQUE INDEX units_company_code ON app.units(company_id,lower(code));
CREATE INDEX units_list ON app.units(company_id,active,code,id);
ALTER TABLE app.units ENABLE ROW LEVEL SECURITY;
CREATE POLICY units_read ON app.units FOR SELECT TO app_runtime
 USING(company_id=app.company_id() AND app.allowed('masterdata.read'));
CREATE POLICY units_insert ON app.units FOR INSERT TO app_runtime
 WITH CHECK(company_id=app.company_id() AND app.allowed('masterdata.manage') AND app.allowed('masterdata.read'));
CREATE POLICY units_update ON app.units FOR UPDATE TO app_runtime
 USING(company_id=app.company_id() AND app.allowed('masterdata.manage') AND app.allowed('masterdata.read'))
 WITH CHECK(company_id=app.company_id() AND app.allowed('masterdata.manage') AND app.allowed('masterdata.read'));
GRANT SELECT,INSERT ON app.units TO app_runtime;
GRANT UPDATE(code,name,active,notes,version,symbol) ON app.units TO app_runtime;
CREATE TRIGGER units_audit BEFORE INSERT OR UPDATE ON app.units FOR EACH ROW EXECUTE FUNCTION app_private.audit_masterdata();

CREATE TABLE app.machines (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid NOT NULL REFERENCES app.companies(id),
 code text NOT NULL CHECK(length(trim(code)) BETWEEN 1 AND 60 AND code=trim(code)),
 name text NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 160 AND name=trim(name)),
 active boolean NOT NULL DEFAULT true,
 notes text NOT NULL DEFAULT '' CHECK(length(notes)<=4000),
 version integer NOT NULL DEFAULT 1 CHECK(version>0),
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(company_id,id),
 machine_type_id uuid, FOREIGN KEY(company_id,machine_type_id) REFERENCES app.machine_types(company_id,id)
);
CREATE UNIQUE INDEX machines_company_code ON app.machines(company_id,lower(code));
CREATE INDEX machines_list ON app.machines(company_id,active,code,id);
ALTER TABLE app.machines ENABLE ROW LEVEL SECURITY;
CREATE POLICY machines_read ON app.machines FOR SELECT TO app_runtime
 USING(company_id=app.company_id() AND app.allowed('masterdata.read'));
CREATE POLICY machines_insert ON app.machines FOR INSERT TO app_runtime
 WITH CHECK(company_id=app.company_id() AND app.allowed('masterdata.manage') AND app.allowed('masterdata.read'));
CREATE POLICY machines_update ON app.machines FOR UPDATE TO app_runtime
 USING(company_id=app.company_id() AND app.allowed('masterdata.manage') AND app.allowed('masterdata.read'))
 WITH CHECK(company_id=app.company_id() AND app.allowed('masterdata.manage') AND app.allowed('masterdata.read'));
GRANT SELECT,INSERT ON app.machines TO app_runtime;
GRANT UPDATE(code,name,active,notes,version,machine_type_id) ON app.machines TO app_runtime;
CREATE TRIGGER machines_audit BEFORE INSERT OR UPDATE ON app.machines FOR EACH ROW EXECUTE FUNCTION app_private.audit_masterdata();

RESET ROLE;
COMMIT;
