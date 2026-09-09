import { readFileSync, writeFileSync } from 'node:fs';
import { X509Certificate } from 'node:crypto';
import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().default('127.0.0.1'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  CORS_ORIGINS: z.string().default('http://localhost:5173'),
  DATABASE_URL: z.string().default(''),
  DATABASE_SSL_MODE: z.enum(['require', 'disable']).default('require'),
  DATABASE_CA_FILE: z.string().default(''),
  DATABASE_CA_PEM: z.string().default(''),
  DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(20).default(5),
  SUPABASE_URL: z.string().url().optional(),
});

export function loadConfig(env: NodeJS.ProcessEnv = process.env) {
  const parsed = schema.safeParse(env);
  if (!parsed.success) throw new Error(`Invalid configuration: ${parsed.error.issues.map(i => i.path.join('.')).join(', ')}`);
  const config = parsed.data;
  const origins = config.CORS_ORIGINS.split(',').map(s => s.trim()).filter(Boolean);
  if (!origins.length || origins.some(origin => {
    try { return new URL(origin).origin !== origin || !/^https?:/.test(origin); } catch { return true; }
  })) throw new Error('CORS_ORIGINS must contain explicit HTTP(S) origins');
  if (config.NODE_ENV === 'production' && (!config.DATABASE_URL || !config.SUPABASE_URL || origins.some(o => !o.startsWith('https://')))) {
    throw new Error('Production requires DATABASE_URL, SUPABASE_URL and HTTPS origins');
  }
  if (config.DATABASE_URL) {
    let url: URL;
    try { url = new URL(config.DATABASE_URL); } catch { throw new Error('Invalid DATABASE_URL'); }
    if (!['postgres:', 'postgresql:'].includes(url.protocol)) throw new Error('DATABASE_URL must use PostgreSQL');
    const username = decodeURIComponent(url.username);
    if (username !== 'app_backend' && !username.startsWith('app_backend.')) throw new Error('DATABASE_URL must use the restricted app_backend role');
    if (url.search) throw new Error('Configure PostgreSQL options through environment fields, not URL query parameters');
    const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    if (config.DATABASE_SSL_MODE === 'disable' && (!loopback || config.NODE_ENV === 'production')) throw new Error('TLS may only be disabled for local development/test');
  }
  return { ...config, origins };
}

export type AppConfig = ReturnType<typeof loadConfig>;

export function databaseTls(config: AppConfig) {
  if (config.DATABASE_SSL_MODE === 'disable') return false as const;
  if (config.DATABASE_CA_PEM) {
    // Fixed writable runtime location; never allow an environment-controlled write path.
    if (config.DATABASE_CA_FILE !== '/app/certs/supabase-ca.crt') throw new Error('Invalid CA destination');
    const pem = validateCaPem(config.DATABASE_CA_PEM);
    writeFileSync(config.DATABASE_CA_FILE, pem, { mode: 0o600 });
  }
  return {
    rejectUnauthorized: true,
    ...(config.DATABASE_CA_FILE ? { ca: validateCaPem(readFileSync(config.DATABASE_CA_FILE, 'utf8')) } : {}),
  };
}

export function validateCaPem(input: string): string {
  try {
    const pem = input.trim();
    if (!/^-----BEGIN CERTIFICATE-----[\s\S]+-----END CERTIFICATE-----$/.test(pem) || pem.includes('PRIVATE KEY')) throw new Error();
    const blocks = pem.match(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g) ?? [];
    if (!blocks.length || blocks.join('').replace(/\s/g, '') !== pem.replace(/\s/g, '')) throw new Error();
    for (const block of blocks) {
      const certificate = new X509Certificate(block);
      if (!certificate.ca || Date.parse(certificate.validFrom) > Date.now() || Date.parse(certificate.validTo) <= Date.now()) throw new Error();
    }
    return pem + '\n';
  } catch { throw new Error('Invalid CA certificate'); }
}
