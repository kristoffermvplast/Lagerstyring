// Read-only hosted connectivity check. Never prints URLs, passwords or raw errors.
const path = require('node:path');
require('dotenv').config({ path: path.resolve(__dirname, '../apps/api/.env'), quiet: true });
const { Pool } = require('pg');
const { loadConfig, databaseTls } = require('../apps/api/dist/config.js');
const { createApp } = require('../apps/api/dist/app.js');

const { diagnostic } = require('./database-diagnostics.cjs');
let stage = 'configuration';
async function verify() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL_MISSING');
  const config = loadConfig();
  console.log('configuration: PASS (restricted username and TLS configuration validated)');
  stage = 'tls_setup';
  if (!config.DATABASE_URL) throw new Error('DATABASE_URL_MISSING');
  if (config.DATABASE_SSL_MODE !== 'require') throw new Error('TLS_REQUIRED');
  const pool = new Pool({ connectionString: config.DATABASE_URL, ssl: databaseTls(config), max: 1, connectionTimeoutMillis: 5000, query_timeout: 5000 });
  // Handle asynchronous idle connection failures without logging potentially sensitive errors.
  pool.on('error', error => { console.error(diagnostic(error, 'idle_connection')); process.exitCode = 1; });
  let app;
  try {
    stage = 'connection_and_role_query';
    const { rows } = await pool.query(`
      select current_user = 'app_backend' as identity_ok,
        not (r.rolsuper or r.rolbypassrls or r.rolcreatedb or r.rolcreaterole or r.rolreplication) as restricted_role,
        r.rolcanlogin and r.rolconnlimit = 10 as login_limits_ok,
        has_schema_privilege(current_user, 'app', 'USAGE') as app_usage,
        not has_schema_privilege(current_user, 'app', 'CREATE') as no_app_create,
        not has_schema_privilege(current_user, 'app_private', 'USAGE') as no_private_access,
        pg_has_role(current_user, 'app_runtime', 'MEMBER') and
          not exists (select 1 from pg_auth_members m join pg_roles parent on parent.oid=m.roleid
                      where m.member=r.oid and parent.rolname <> 'app_runtime') as memberships_ok,
        not pg_has_role(current_user, 'app_owner', 'MEMBER') as no_owner_membership,
        coalesce((select ssl from pg_stat_ssl where pid=pg_backend_pid()), false) as tls_active
      from pg_roles r where r.rolname=current_user
    `);
    if (rows.length !== 1) throw new Error('ROLE_CHECK_FAILED');
    for (const [name, passed] of Object.entries(rows[0])) {
      console.log(`${name}: ${passed === true ? 'PASS' : 'FAIL'}`);
    }
    if (Object.values(rows[0]).some(value => value !== true)) throw new Error('ROLE_CHECK_FAILED');
    stage = 'nest_readiness';
    // Exercise the actual NestJS readiness controller on a local ephemeral port.
    app = await createApp({ ...config, NODE_ENV: 'test', HOST: '127.0.0.1' });
    await app.listen(0, '127.0.0.1');
    const origin = await app.getUrl();
    for (const [route, expected] of [['live', 'ok'], ['ready', 'ready']]) {
      const response = await fetch(`${origin}/api/health/${route}`, { signal: AbortSignal.timeout(10000) });
      const body = await response.json();
      if (response.status !== 200 || body.status !== expected) throw new Error('READINESS_FAILED');
      console.log(`NestJS ${route}: PASS (HTTP 200)`);
    }
  } finally {
    await app?.close();
    await pool.end();
  }
}

verify().catch(error => {
  console.error(diagnostic(error, stage));
  process.exitCode = 1;
});
