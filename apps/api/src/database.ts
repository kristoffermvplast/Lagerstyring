import { OnApplicationShutdown } from '@nestjs/common';
import { Kysely, PostgresDialect, sql } from 'kysely';
import { Pool } from 'pg';
import { AppConfig, databaseTls } from './config';

// No business tables exist in Phase 1. Extend this type only in authorized phases.
export type Database = Record<string, never>;

export class DatabaseService implements OnApplicationShutdown {
  private readonly db?: Kysely<Database>;

  constructor(config: AppConfig) {
    if (!config.DATABASE_URL) return;
    this.db = new Kysely<Database>({ dialect: new PostgresDialect({ pool: new Pool({
      connectionString: config.DATABASE_URL,
      ssl: databaseTls(config),
      max: config.DATABASE_POOL_MAX,
      connectionTimeoutMillis: 3000,
      idleTimeoutMillis: 10000,
      statement_timeout: 3000,
      query_timeout: 4000,
      application_name: 'lagerstyring-api',
    }) }) });
  }

  async ready(): Promise<boolean> {
    if (!this.db) return false;
    try {
      const result = await sql<{ ready: boolean }>`
        select current_user = 'app_backend'
          and not r.rolsuper and not r.rolbypassrls
          and not r.rolcreaterole and not r.rolcreatedb
          and has_schema_privilege(current_user, 'app', 'USAGE')
          and not has_schema_privilege(current_user, 'app', 'CREATE')
          and not has_schema_privilege(current_user, 'app_private', 'USAGE')
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
