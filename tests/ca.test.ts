import { rootCertificates } from 'node:tls';
import { describe, expect, it } from 'vitest';
import { validateCaPem, databaseTls, loadConfig } from '../apps/api/src/config';

describe('runtime CA validation', () => {
  it('accepts a valid public CA and rejects malformed or private material without echoing it', () => {
    const valid = rootCertificates.find(pem => { try { validateCaPem(pem); return true; } catch { return false; } });
    expect(valid).toBeTruthy();
    expect(validateCaPem(valid!)).toContain('BEGIN CERTIFICATE');
    for (const invalid of ['SECRET', '-----BEGIN PRIVATE KEY-----SECRET', valid + '\nSECRET']) {
      expect(() => validateCaPem(invalid)).toThrow('Invalid CA certificate');
    }
  });
  it('retains strict TLS and refuses arbitrary certificate write paths', () => {
    expect(databaseTls(loadConfig({}))).toEqual({ rejectUnauthorized: true });
    expect(() => databaseTls(loadConfig({ DATABASE_CA_PEM: 'SECRET', DATABASE_CA_FILE: '/tmp/unapproved' }))).toThrow('Invalid CA destination');
  });
});
