import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const db = new PGlite();
beforeAll(async () => {
  await db.exec('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role; CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY); CREATE TABLE auth.sessions(id uuid PRIMARY KEY,user_id uuid NOT NULL REFERENCES auth.users);');
  for (const name of readdirSync('supabase/migrations').filter(name => name.endsWith('.sql')).sort()) {
    await db.exec(readFileSync(`supabase/migrations/${name}`, 'utf8'));
  }
});
afterAll(() => db.close());

describe('migration security in isolated PostgreSQL engine', () => {
  it('creates access and Phase 3–10 masterdata, inventory and production tables', async () => {
    const { rows } = await db.query("select count(*)::int as count from pg_tables where schemaname in ('app','app_private')");
    expect(rows).toEqual([{ count: 29 }]);
  });
  it('runtime role cannot bypass RLS, own schemas or administer roles', async () => {
    const { rows } = await db.query("select rolsuper, rolbypassrls, rolcreatedb, rolcreaterole from pg_roles where rolname='app_backend'");
    expect(rows).toEqual([{ rolsuper: false, rolbypassrls: false, rolcreatedb: false, rolcreaterole: false }]);
    const rights = await db.query("select has_schema_privilege('app_backend','app','USAGE') as app_usage, has_schema_privilege('app_backend','app','CREATE') as app_create, has_schema_privilege('app_backend','app_private','USAGE') as private_usage");
    expect(rights.rows).toEqual([{ app_usage: true, app_create: false, private_usage: false }]);
  });
  it('browser roles cannot access either schema', async () => {
    const { rows } = await db.query("select has_schema_privilege('anon','app','USAGE') as anon_access, has_schema_privilege('authenticated','app','USAGE') as auth_access, has_schema_privilege('service_role','app','USAGE') as service_access");
    expect(rows).toEqual([{ anon_access: false, auth_access: false, service_access: false }]);
  });
  it('new functions and tables are not accidentally granted to browser/runtime roles', async () => {
    await db.exec("BEGIN; SET LOCAL ROLE app_owner; CREATE TABLE app.boundary_probe(id int); CREATE FUNCTION app.boundary_probe_fn() RETURNS int LANGUAGE sql AS 'SELECT 1'; RESET ROLE;");
    try {
      const { rows } = await db.query("select has_function_privilege('authenticated','app.boundary_probe_fn()','EXECUTE') as browser_execute, has_function_privilege('app_backend','app.boundary_probe_fn()','EXECUTE') as runtime_execute, has_table_privilege('app_backend','app.boundary_probe','SELECT') as runtime_read");
      expect(rows).toEqual([{ browser_execute: false, runtime_execute: false, runtime_read: false }]);
    } finally { await db.exec('ROLLBACK'); }
  });
});
