-- Phase 2: authentication and access boundaries. Apply once, never from runtime.
-- No customers, companies, people or other business fixtures are seeded here.
BEGIN;
-- Supabase postgres can reference auth.users but cannot delegate that privilege.
-- Create the FK as migration administrator, then transfer the application table.

CREATE TABLE app.profiles (
 id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE RESTRICT,
 display_name text NOT NULL DEFAULT '' CHECK (length(display_name) <= 120),
 created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE app.profiles OWNER TO app_owner;
SET LOCAL ROLE app_owner;

CREATE TABLE app.companies (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 name text NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 160),
 active boolean NOT NULL DEFAULT true
);
CREATE TABLE app.permissions (
 code text PRIMARY KEY,
 description text NOT NULL
);
INSERT INTO app.permissions VALUES
 ('access.read','Se virksomhedens brugere og roller'),
 ('access.manage','Administrere virksomhedens medlemskaber og roller');
CREATE TABLE app.roles (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 company_id uuid NOT NULL REFERENCES app.companies(id),
 name text NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 80),
 is_admin boolean NOT NULL DEFAULT false,
 UNIQUE(company_id,id), UNIQUE(company_id,name)
);
CREATE UNIQUE INDEX one_admin_role ON app.roles(company_id) WHERE is_admin;
CREATE TABLE app.role_permissions (
 company_id uuid NOT NULL,
 role_id uuid NOT NULL,
 permission_code text NOT NULL REFERENCES app.permissions(code),
 PRIMARY KEY(company_id,role_id,permission_code),
 FOREIGN KEY(company_id,role_id) REFERENCES app.roles(company_id,id)
);
CREATE TABLE app.memberships (
 company_id uuid NOT NULL REFERENCES app.companies(id),
 user_id uuid NOT NULL REFERENCES app.profiles(id),
 role_id uuid NOT NULL,
 active boolean NOT NULL DEFAULT true,
 version integer NOT NULL DEFAULT 1 CHECK (version > 0),
 PRIMARY KEY(company_id,user_id),
 FOREIGN KEY(company_id,role_id) REFERENCES app.roles(company_id,id)
);
CREATE INDEX memberships_user ON app.memberships(user_id,company_id);
CREATE TABLE app.revoked_sessions (
 session_id uuid PRIMARY KEY,
 user_id uuid NOT NULL REFERENCES app.profiles(id),
 revoked_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE app.access_audit (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 company_id uuid NOT NULL REFERENCES app.companies(id),
 actor_id uuid NOT NULL REFERENCES app.profiles(id),
 action text NOT NULL,
 target_id uuid NOT NULL,
 before_value jsonb,
 after_value jsonb,
 occurred_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX access_audit_company_date ON app.access_audit(company_id,occurred_at DESC);

CREATE FUNCTION app.actor_id() RETURNS uuid LANGUAGE sql STABLE
 SET search_path = pg_catalog AS $$ SELECT nullif(current_setting('app.user_id',true),'')::uuid $$;
CREATE FUNCTION app.company_id() RETURNS uuid LANGUAGE sql STABLE
 SET search_path = pg_catalog AS $$ SELECT nullif(current_setting('app.company_id',true),'')::uuid $$;
-- Narrow read-only SECURITY DEFINER helpers avoid recursive membership RLS.
-- app_owner owns these tables; it is NOLOGIN. No arbitrary SQL or actor parameter.
CREATE FUNCTION app.is_member(target uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
 SET search_path = pg_catalog AS $$
 SELECT EXISTS(SELECT 1 FROM app.memberships m JOIN app.companies c ON c.id=m.company_id
 WHERE m.company_id=target AND m.user_id=app.actor_id() AND m.active AND c.active)
 $$;
CREATE FUNCTION app.allowed(permission text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
 SET search_path = pg_catalog AS $$
 SELECT EXISTS(SELECT 1 FROM app.memberships m
 JOIN app.companies c ON c.id=m.company_id
 JOIN app.roles r ON r.company_id=m.company_id AND r.id=m.role_id
 WHERE m.company_id=app.company_id() AND m.user_id=app.actor_id() AND m.active AND c.active
 AND (r.is_admin OR EXISTS(SELECT 1 FROM app.role_permissions p
 WHERE p.company_id=m.company_id AND p.role_id=m.role_id AND p.permission_code=permission)))
 $$;

ALTER TABLE app.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.role_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.revoked_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.access_audit ENABLE ROW LEVEL SECURITY;

CREATE POLICY profiles_self_read ON app.profiles FOR SELECT TO app_runtime USING(id=app.actor_id() OR (app.allowed('access.read') AND EXISTS(SELECT 1 FROM app.memberships m WHERE m.user_id=profiles.id AND m.company_id=app.company_id())));
CREATE POLICY profiles_self_insert ON app.profiles FOR INSERT TO app_runtime WITH CHECK(id=app.actor_id());
CREATE POLICY profiles_self_update ON app.profiles FOR UPDATE TO app_runtime USING(id=app.actor_id()) WITH CHECK(id=app.actor_id());
CREATE POLICY company_members ON app.companies FOR SELECT TO app_runtime USING(app.is_member(id));
CREATE POLICY permission_catalog ON app.permissions FOR SELECT TO app_runtime USING(app.actor_id() IS NOT NULL);
CREATE POLICY roles_read ON app.roles FOR SELECT TO app_runtime USING(company_id=app.company_id() AND app.is_member(company_id));
CREATE POLICY roles_create ON app.roles FOR INSERT TO app_runtime WITH CHECK(company_id=app.company_id() AND app.allowed('access.manage') AND NOT is_admin);
CREATE POLICY roles_edit ON app.roles FOR UPDATE TO app_runtime USING(company_id=app.company_id() AND app.allowed('access.manage') AND NOT is_admin) WITH CHECK(company_id=app.company_id() AND NOT is_admin);
CREATE POLICY role_permissions_read ON app.role_permissions FOR SELECT TO app_runtime USING(company_id=app.company_id() AND app.is_member(company_id));
CREATE POLICY role_permissions_insert ON app.role_permissions FOR INSERT TO app_runtime WITH CHECK(company_id=app.company_id() AND app.allowed('access.manage'));
CREATE POLICY role_permissions_delete ON app.role_permissions FOR DELETE TO app_runtime USING(company_id=app.company_id() AND app.allowed('access.manage'));
CREATE POLICY memberships_read ON app.memberships FOR SELECT TO app_runtime USING(user_id=app.actor_id() OR (company_id=app.company_id() AND app.allowed('access.read')));
CREATE POLICY memberships_insert ON app.memberships FOR INSERT TO app_runtime WITH CHECK(company_id=app.company_id() AND app.allowed('access.manage'));
CREATE POLICY memberships_update ON app.memberships FOR UPDATE TO app_runtime USING(company_id=app.company_id() AND app.allowed('access.manage')) WITH CHECK(company_id=app.company_id());
CREATE POLICY sessions_read ON app.revoked_sessions FOR SELECT TO app_runtime USING(user_id=app.actor_id());
CREATE POLICY sessions_revoke ON app.revoked_sessions FOR INSERT TO app_runtime WITH CHECK(user_id=app.actor_id() AND session_id=nullif(current_setting('app.session_id',true),'')::uuid);
CREATE POLICY audit_read ON app.access_audit FOR SELECT TO app_runtime USING(company_id=app.company_id() AND app.allowed('access.read'));
CREATE POLICY audit_insert ON app.access_audit FOR INSERT TO app_runtime WITH CHECK(company_id=app.company_id() AND actor_id=app.actor_id() AND app.allowed('access.manage'));

GRANT EXECUTE ON FUNCTION app.actor_id(), app.company_id(), app.is_member(uuid), app.allowed(text) TO app_runtime;
GRANT SELECT ON app.profiles,app.companies,app.permissions,app.roles,app.role_permissions,app.memberships,app.revoked_sessions,app.access_audit TO app_runtime;
GRANT INSERT ON app.profiles,app.roles,app.role_permissions,app.memberships,app.revoked_sessions,app.access_audit TO app_runtime;
GRANT UPDATE(display_name) ON app.profiles TO app_runtime;
GRANT UPDATE(name) ON app.roles TO app_runtime;
GRANT UPDATE(role_id,active,version) ON app.memberships TO app_runtime;
GRANT DELETE ON app.role_permissions TO app_runtime;
-- Audit and last-admin invariant are enforced even for direct runtime SQL.
CREATE FUNCTION app_private.audit_access_change() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
 SET search_path = pg_catalog AS $$
DECLARE company uuid; target uuid; before_row jsonb; after_row jsonb;
BEGIN
 before_row := CASE WHEN TG_OP <> 'INSERT' THEN to_jsonb(OLD) ELSE NULL END;
 after_row := CASE WHEN TG_OP <> 'DELETE' THEN to_jsonb(NEW) ELSE NULL END;
 company := coalesce((after_row->>'company_id')::uuid,(before_row->>'company_id')::uuid);
 target := coalesce((after_row->>'user_id')::uuid,(before_row->>'user_id')::uuid,
                    (after_row->>'role_id')::uuid,(before_row->>'role_id')::uuid,
                    (after_row->>'id')::uuid,(before_row->>'id')::uuid);
 IF TG_TABLE_NAME='memberships' AND TG_OP='UPDATE' THEN
 IF OLD.active AND
    EXISTS(SELECT 1 FROM app.roles WHERE id=OLD.role_id AND company_id=company AND is_admin) AND
    (NOT NEW.active OR NOT EXISTS(SELECT 1 FROM app.roles WHERE id=NEW.role_id AND company_id=company AND is_admin)) THEN
   -- Serialize admin changes; SERIALIZABLE transactions also prevent write skew.
   PERFORM 1 FROM app.companies WHERE id=company FOR UPDATE;
   IF NOT EXISTS(SELECT 1 FROM app.memberships m JOIN app.roles r ON r.id=m.role_id AND r.company_id=m.company_id
                 WHERE m.company_id=company AND m.user_id<>OLD.user_id AND m.active AND r.is_admin) THEN
     RAISE EXCEPTION 'Last administrator must remain active' USING ERRCODE='23514';
   END IF;
 END IF;
 END IF;
 IF app.actor_id() IS NOT NULL THEN
   INSERT INTO app.access_audit(company_id,actor_id,action,target_id,before_value,after_value)
   VALUES(company,app.actor_id(),TG_TABLE_NAME||'.'||lower(TG_OP),target,before_row,after_row);
 END IF;
 RETURN coalesce(NEW,OLD);
END $$;
CREATE TRIGGER memberships_audit BEFORE INSERT OR UPDATE ON app.memberships FOR EACH ROW EXECUTE FUNCTION app_private.audit_access_change();
CREATE TRIGGER roles_audit BEFORE INSERT OR UPDATE ON app.roles FOR EACH ROW EXECUTE FUNCTION app_private.audit_access_change();
CREATE TRIGGER role_permissions_audit BEFORE INSERT OR DELETE ON app.role_permissions FOR EACH ROW EXECUTE FUNCTION app_private.audit_access_change();
REVOKE INSERT ON app.access_audit FROM app_runtime;
-- Runtime cannot delete history/users or create companies/admin roles.
RESET ROLE;
-- Only this audited boolean probe reads Supabase-managed session metadata.
-- postgres owns the function; runtime receives no access to auth tables/schema.
CREATE FUNCTION app.session_active() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
 SET search_path = pg_catalog AS $$
 SELECT EXISTS(SELECT 1 FROM auth.sessions s
 WHERE s.id=nullif(current_setting('app.session_id',true),'')::uuid
 AND s.user_id=nullif(current_setting('app.user_id',true),'')::uuid)
 $$;
REVOKE ALL ON FUNCTION app.session_active() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION app.session_active() TO app_runtime;
COMMIT;
