import { OnApplicationShutdown, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { Kysely, PostgresDialect, sql } from 'kysely';
import { Pool, PoolClient } from 'pg';
import { Actor } from './auth';
import { AppConfig, databaseTls } from './config';

// Phase 2 access queries use parameterized pg SQL; warehouse types remain deferred.
export type Database = Record<string, never>;

export class DatabaseService implements OnApplicationShutdown {
  private readonly authConfigured: boolean;
  private readonly pool?: Pool;
  private readonly db?: Kysely<Database>;

  constructor(config: AppConfig) {
    this.authConfigured = !!(config.SUPABASE_URL && config.SUPABASE_PUBLISHABLE_KEY);
    if (!config.DATABASE_URL) return;
    this.pool = new Pool({
      connectionString: config.DATABASE_URL,
      ssl: databaseTls(config),
      max: config.DATABASE_POOL_MAX,
      connectionTimeoutMillis: 3000,
      idleTimeoutMillis: 10000,
      statement_timeout: 3000,
      query_timeout: 4000,
      application_name: 'lagerstyring-api',
    });
    this.db = new Kysely<Database>({ dialect: new PostgresDialect({ pool: this.pool }) });
  }

  async asActor<T>(actor: Actor, companyId: string | null, work: (client: PoolClient) => Promise<T>): Promise<T> {
    if (!this.pool) throw new ServiceUnavailableException();
    const client = await this.pool.connect();
    let discard = false;
    try {
      await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
      await client.query("select set_config('app.user_id',$1,true), set_config('app.company_id',$2,true), set_config('app.session_id',$3,true)", [actor.userId, companyId ?? '', actor.sessionId]);
      const session = await client.query('select app.session_active() and not exists(select 1 from app.revoked_sessions where session_id=$1) as valid', [actor.sessionId]);
      if (session.rows[0]?.valid !== true) throw new UnauthorizedException();
      const value = await work(client);
      await client.query('COMMIT');
      return value;
    } catch (error) {
      try { await client.query('ROLLBACK'); } catch { discard = true; }
      throw error;
    } finally { client.release(discard); }
  }

  async ready(): Promise<boolean> {
    if (!this.db || !this.authConfigured) return false;
    try {
      const result = await sql<{ ready: boolean }>`
        select current_user = 'app_backend'
          and not r.rolsuper and not r.rolbypassrls
          and not r.rolcreaterole and not r.rolcreatedb
          and has_schema_privilege(current_user, 'app', 'USAGE')
          and not has_schema_privilege(current_user, 'app', 'CREATE')
          and not has_schema_privilege(current_user, 'app_private', 'USAGE')
          and to_regclass('app.memberships') is not null
          and to_regprocedure('app.session_active()') is not null
          as ready
        from pg_roles r where r.rolname = current_user
      `.execute(this.db);
      return result.rows[0]?.ready === true;
    } catch {
      // Never return connection strings, SQL or credentials through a public health endpoint.
      return false;
    }
  }

  async onApplicationShutdown() { await this.db?.destroy(); }
}
