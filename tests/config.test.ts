import { describe, expect, it } from 'vitest';
import { loadConfig } from '../apps/api/src/config';

describe('environment security boundaries', () => {
  it('allows foundation preview without inventing database credentials', () => expect(loadConfig({}).DATABASE_URL).toBe(''));
  it('requires explicit production configuration', () => expect(() => loadConfig({ NODE_ENV: 'production' })).toThrow());
  it('rejects privileged database identities without leaking passwords', () => {
    expect(() => loadConfig({ DATABASE_URL: 'postgresql://postgres:SECRET@localhost/db' })).toThrow('restricted app_backend');
    try { loadConfig({ DATABASE_URL: 'postgresql://postgres:SECRET@localhost/db' }); } catch (error) { expect(String(error)).not.toContain('SECRET'); }
  });
  it('rejects URL options that could override TLS policy', () => expect(() => loadConfig({ DATABASE_URL: 'postgresql://app_backend:x@example.com/db?sslmode=no-verify' })).toThrow());
  it('rejects insecure remote database transport', () => expect(() => loadConfig({ DATABASE_URL: 'postgresql://app_backend:x@example.com/db', DATABASE_SSL_MODE: 'disable' })).toThrow());
  it('allows local database transport for tests', () => expect(loadConfig({ NODE_ENV: 'test', DATABASE_URL: 'postgresql://app_backend:x@127.0.0.1:54322/postgres', DATABASE_SSL_MODE: 'disable' }).DATABASE_SSL_MODE).toBe('disable'));
  it('rejects wildcard origins', () => expect(() => loadConfig({ CORS_ORIGINS: '*' })).toThrow());
  it('accepts restricted Supavisor role naming', () => expect(loadConfig({ DATABASE_URL: 'postgresql://app_backend.project:x@example.com/postgres' }).DATABASE_URL).toContain('app_backend.project'));
});
