import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { Kysely, PostgresDialect } = require('kysely');
const { DatabaseService } = require('../apps/api/dist/database.js');

const db = new PGlite();
beforeAll(async () => {
  await db.exec('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role; CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY); CREATE TABLE auth.sessions(id uuid PRIMARY KEY,user_id uuid NOT NULL REFERENCES auth.users);');
  for (const name of readdirSync('supabase/migrations').filter(name => name.endsWith('.sql')).sort()) {
    await db.exec(readFileSync(`supabase/migrations/${name}`, 'utf8'));
  }
});
afterAll(() => db.close());

describe('migration security in isolated PostgreSQL engine', () => {
  it('readiness succeeds without an actor while permission rows remain protected by RLS', async () => {
    expect((await db.query("select exists(select 1 from app.permissions where code='inventory.transfer') as present")).rows).toEqual([{ present: true }]);
    const service = new DatabaseService({ SUPABASE_URL: 'http://localhost', SUPABASE_PUBLISHABLE_KEY: 'local-test' });
    service.db = new Kysely({ dialect: new PostgresDialect({ pool: {
      connect: async () => ({
        query: async (query: string, parameters: unknown[]) => {
          const result = await db.query(query, parameters);
          return { rows: result.rows, rowCount: result.rows.length };
        },
        release: () => {},
      }),
      end: async () => {},
    } }) });
    await db.exec('BEGIN; SET LOCAL ROLE app_backend;');
    try {
      expect((await db.query("select app.actor_id() is null as no_actor, exists(select 1 from app.permissions where code='inventory.transfer') as visible")).rows).toEqual([{ no_actor: true, visible: false }]);
      expect(await service.ready()).toBe(true);
      expect((await db.query('select count(*)::int as count from app.permissions')).rows).toEqual([{ count: 0 }]);
      await db.exec('RESET ROLE; ALTER TABLE app.production_orders RENAME TO readiness_missing_orders; SET LOCAL ROLE app_backend;');
      expect(await service.ready()).toBe(false);
    } finally {
      await db.exec('ROLLBACK');
      await service.onApplicationShutdown();
    }
  });
  it('creates access and Phase 3–13 masterdata, inventory and production tables', async () => {
    const { rows } = await db.query("select count(*)::int as count from pg_tables where schemaname in ('app','app_private')");
    expect(rows).toEqual([{ count: 40 }]);
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
