import { createRequire } from 'node:module';
import { TLSSocket } from 'node:tls';
import { describe, expect, it } from 'vitest';
const require = createRequire(import.meta.url);
const { clientTlsChecks } = require('../scripts/database-tls-check.cjs');

describe('client-side TLS evidence (independent of PostgreSQL-side SSL)', () => {
  it('fails closed for missing or plaintext transport', () => {
    for (const client of [undefined, {}, { connection: { stream: { encrypted: true, authorized: true } } }]) {
      expect(Object.values(clientTlsChecks(client))).toEqual([false, false, false]);
    }
  });
  it('requires authorization, matching hostname and modern TLS separately', () => {
    const socket = new TLSSocket();
    try {
      socket.authorized = true;
      socket.getProtocol = () => 'TLSv1.3';
      socket.getPeerCertificate = (() => ({ subjectaltname: 'DNS:pool.example.test' })) as typeof socket.getPeerCertificate;
      const client = { host: 'pool.example.test', connection: { stream: socket } };
      expect(Object.values(clientTlsChecks(client))).toEqual([true, true, true]);
      client.host = 'wrong.example.test';
      expect(clientTlsChecks(client).client_tls_hostname).toBe(false);
      socket.authorized = false;
      expect(clientTlsChecks(client).client_tls_authorized).toBe(false);
      socket.getProtocol = () => 'TLSv1';
      expect(clientTlsChecks(client).client_tls_encrypted).toBe(false);
    } finally { socket.destroy(); }
  });
});
