import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { spawn, ChildProcess } from 'node:child_process';

let child: ChildProcess;
const base = 'http://127.0.0.1:3099';
beforeAll(async () => {
  // Compiled Nest code exercises TypeScript decorator metadata exactly as production does.
  child = spawn(process.execPath, ['apps/api/dist/main.js'], { env: { ...process.env, NODE_ENV: 'test', HOST: '127.0.0.1', PORT: '3099', DATABASE_URL: '', CORS_ORIGINS: 'http://localhost:5173' }, stdio: 'pipe' });
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error('API process exited before readiness');
    try { if ((await fetch(`${base}/api/health/live`)).ok) return; } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('API did not start');
});
afterAll(async () => { if (child && child.exitCode === null) { const stopped = new Promise(resolve => child.once('exit', resolve)); child.kill('SIGTERM'); await stopped; } });

describe('running NestJS foundation', () => {
  it('reports liveness without claiming database readiness', async () => {
    const live = await fetch(`${base}/api/health/live`);
    expect(live.status).toBe(200);
    expect(await live.json()).toEqual({ status: 'ok' });
    const ready = await fetch(`${base}/api/health/ready`);
    expect(ready.status).toBe(503);
    expect(await ready.json()).toMatchObject({ statusCode: 503, message: 'Service unavailable' });
  });
  it('sets security headers and server-generated request identifiers', async () => {
    const response = await fetch(`${base}/api/health/live`, { headers: { 'X-Request-Id': 'untrusted-value' } });
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.get('x-powered-by')).toBeNull();
    expect(response.headers.get('x-request-id')).not.toBe('untrusted-value');
    expect(response.headers.get('cache-control')).toBe('no-store');
  });
  it('does not authorize an unknown browser origin', async () => {
    const response = await fetch(`${base}/api/health/live`, { headers: { Origin: 'https://untrusted.example' } });
    expect(response.headers.get('access-control-allow-origin')).toBeNull();
  });
  it('allows the configured local origin', async () => {
    const response = await fetch(`${base}/api/health/live`, { headers: { Origin: 'http://localhost:5173' } });
    expect(response.headers.get('access-control-allow-origin')).toBe('http://localhost:5173');
  });
  it('does not expose business write endpoints', async () => {
    const response = await fetch(`${base}/api/items`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    expect(response.status).toBe(404);
  });
  it('provides technical API documentation in development/test', async () => expect((await fetch(`${base}/api/docs-json`)).status).toBe(200));
});
