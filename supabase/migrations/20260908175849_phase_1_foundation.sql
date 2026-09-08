-- Phase 1: infrastructure only. No business tables, users or master data.
-- Apply as postgres. Future object migrations must SET LOCAL ROLE app_owner.
CREATE ROLE app_owner NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
CREATE ROLE app_runtime NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
-- No password is included. Provision the secret outside migrations before hosted runtime use.
CREATE ROLE app_backend LOGIN INHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 10;
GRANT app_owner TO postgres;
GRANT app_runtime TO app_backend;

CREATE SCHEMA app AUTHORIZATION app_owner;
CREATE SCHEMA app_private AUTHORIZATION app_owner;
REVOKE ALL ON SCHEMA app, app_private FROM PUBLIC, anon, authenticated, service_role;
GRANT USAGE ON SCHEMA app TO app_runtime;

ALTER ROLE app_backend SET search_path = pg_catalog, app;
ALTER ROLE app_backend SET statement_timeout = '5s';
ALTER ROLE app_backend SET lock_timeout = '3s';
ALTER ROLE app_backend SET idle_in_transaction_session_timeout = '10s';

-- Global defaults for this dedicated object owner are essential: a per-schema REVOKE
-- cannot remove PostgreSQL's global PUBLIC EXECUTE default on new functions.
ALTER DEFAULT PRIVILEGES FOR ROLE app_owner
  REVOKE ALL ON TABLES FROM PUBLIC, anon, authenticated, service_role, app_runtime, app_backend;
ALTER DEFAULT PRIVILEGES FOR ROLE app_owner
  REVOKE ALL ON SEQUENCES FROM PUBLIC, anon, authenticated, service_role, app_runtime, app_backend;
ALTER DEFAULT PRIVILEGES FOR ROLE app_owner
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC, anon, authenticated, service_role, app_runtime, app_backend;
ALTER DEFAULT PRIVILEGES FOR ROLE app_owner
  REVOKE USAGE ON TYPES FROM PUBLIC, anon, authenticated, service_role, app_runtime, app_backend;

COMMENT ON SCHEMA app IS 'Lagerstyring business schema. NestJS only; not exposed through Data API.';
COMMENT ON SCHEMA app_private IS 'Private infrastructure. No browser or ordinary application access.';
COMMENT ON ROLE app_backend IS 'Restricted NestJS runtime login. Secret provisioned outside version control.';
