import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
const require = createRequire(import.meta.url);
const { diagnostic } = require('../scripts/database-diagnostics.cjs');

describe('secret-safe database diagnostics', () => {
  it('classifies authentication, TLS, permissions and network errors without raw details', () => {
    for (const [code, expected] of [['28P01', 'AUTHENTICATION_FAILED'], ['SELF_SIGNED_CERT_IN_CHAIN', 'TLS_CERTIFICATE_FAILED'], ['42501', 'PERMISSION_DENIED'], ['EAI_AGAIN', 'DNS_TEMPORARY_FAILURE']]) {
      const output = diagnostic({ code, message: 'postgresql://app_backend:SECRET@host/db', detail: 'SECRET' }, 'connection_and_role_query');
      expect(output).toContain(expected);
      expect(output).not.toContain('SECRET');
      expect(output).not.toContain('postgresql://');
    }
  });
  it('does not print unknown codes, messages, inherited keys or config values', () => {
    for (const error of [{ code: 'SECRET', message: 'SECRET' }, { code: 'constructor', message: 'toString' }, new Error('SECRET')]) {
      expect(diagnostic(error, 'connection_and_role_query')).toContain('UNCLASSIFIED_DATABASE_FAILURE');
      expect(diagnostic(error, 'configuration')).not.toContain('SECRET');
    }
  });
});
