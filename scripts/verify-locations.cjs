'use strict';
// Operator verification only. No secrets in arguments, files, logs or shell history.
const { Writable } = require('node:stream');
const readline = require('node:readline');
const defaults = {
  authOrigin: 'https://puwyontrchonoepisgun.supabase.co',
  apiOrigin: 'https://lagerstyring-production-9671.up.railway.app',
};
function requirePass(ok, name, report) {
  report(`${name}: ${ok ? 'PASS' : 'FAIL'}`);
  if (!ok) throw new Error('Verification failed');
}
// Never echo provider messages or arbitrary error codes: they can contain secrets.
async function reportLoginFailure(response, report) {
  report(`LOGIN_HTTP_STATUS: ${response.status}`);
  let body;
  try { body = await response.json(); } catch { body = null; }
  const allowed = new Set([
    'invalid_credentials', 'email_not_confirmed', 'phone_not_confirmed',
    'user_banned', 'user_not_found', 'email_provider_disabled',
    'over_request_rate_limit', 'over_email_send_rate_limit',
    'captcha_failed', 'validation_failed', 'unexpected_failure',
    'request_timeout', 'bad_json', 'bad_jwt',
  ]);
  // A numeric HTTP `code` must not hide a useful `error_code`.
  const code = [body?.error_code, body?.code].find(value => allowed.has(value));
  // Older OAuth responses use error_description; match exact known messages only.
  const messages = new Map([
    ['Invalid login credentials', 'invalid_credentials'],
    ['Email not confirmed', 'email_not_confirmed'],
    ['Invalid API key', 'API_KEY_REJECTED'],
    ['Email logins are disabled', 'email_provider_disabled'],
  ]);
  const messageCode = [body?.error_description, body?.msg, body?.message]
    .map(value => messages.get(value)).find(Boolean);
  const safeCode = code ?? messageCode ??
    (body?.error === 'invalid_grant' ? 'OAUTH_INVALID_GRANT' : 'UNCLASSIFIED');
  report(`LOGIN_ERROR_CODE: ${safeCode}`);
}
async function verify(config, request = fetch, report = console.log) {
  let token; let authToken; let providerLogoutFailed = false;
  const auth = (path, body, bearer) => request(`${config.authOrigin}/auth/v1/${path}`, {
    method: 'POST', headers: { apikey: config.key, 'Content-Type': 'application/json', ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(15000), redirect: 'error',
  });
  const api = (path, bearer, method = 'GET', body) => request(`${config.apiOrigin}/api${path}`, {
    method, headers: { Authorization: `Bearer ${bearer}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(15000), redirect: 'error',
  });
  try {
    const login = await auth('token?grant_type=password', { email: config.email, password: config.password });
    config.password = '';
    if (!login.ok) await reportLoginFailure(login, report);
    requirePass(login.ok, 'REAL_SUPABASE_LOGIN', report);
    const session = await login.json(); token = session.access_token; authToken = token;
    requirePass(typeof token === 'string' && !!session.user?.id, 'SESSION_RECEIVED', report);
    const meResponse = await api('/me', token);
    requirePass(meResponse.status === 200, 'BACKEND_ACCEPTS_SESSION', report);
    const me = await meResponse.json();
    requirePass(me.user?.id === session.user.id, 'PROFILE_IDENTITY', report);
    const membership = me.memberships?.find(m => m.name === config.companyName);
    requirePass(!!membership, 'COMPANY_MEMBERSHIP', report);
    const permissionsResponse = await api(`/companies/${membership.company_id}/access`, token);
    requirePass(permissionsResponse.status === 200, 'COMPANY_ACCESS', report);
    const permissions = await permissionsResponse.json();
    requirePass(['masterdata.read','masterdata.manage'].every(code => permissions.permissions?.some(p => p.code === code)), 'MASTERDATA_ADMIN_PERMISSIONS', report);
    const foreign = config.isolationCompanyId;
    requirePass(typeof foreign === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(foreign) &&
      foreign !== membership.company_id && !me.memberships.some(m => m.company_id === foreign), 'ISOLATION_PRECONDITIONS', report);
    const prefix = `/companies/${membership.company_id}/locations`;
    const foreignPrefix = `/companies/${foreign}/locations`;
    const response = await api(prefix+'?limit=1', token);
    requirePass(response.status === 200, 'LOCATIONS_READ', report);
    const body = await response.json();
    requirePass(Array.isArray(body.items) && body.items.every(row => row.company_id === membership.company_id), 'LOCATIONS_RESPONSE_SCOPE', report);
    requirePass((await api(foreignPrefix, token)).status === 403, 'LOCATIONS_FOREIGN_DENIED', report);
    const record = body.items[0];
    if (record) {
      const detail = await api(prefix+'/'+record.id, token);
      requirePass(detail.status === 200, 'LOCATION_DETAIL_READ', report);
      const data = await detail.json();
      requirePass(data.company_id === membership.company_id && Array.isArray(data.path) && data.path.at(-1)?.id === record.id, 'LOCATION_PATH', report);
      requirePass((await api(prefix+'/'+record.id+'/history', token)).status === 200, 'LOCATION_HISTORY_READ', report);
      requirePass((await api(prefix+'?parent_id='+record.id, token)).status === 200, 'LOCATION_CHILDREN_READ', report);
      for (const suffix of ['', '/history']) requirePass((await api(foreignPrefix+'/'+record.id+suffix, token)).status === 403, 'LOCATION_DETAIL_FOREIGN_DENIED', report);
    } else report('LOCATION_EXISTING_RECORD: NOT_RUN (no existing location; no fixture created)');
    const probe = '00000000-0000-4000-8000-000000000000';
    for (const suffix of ['', '/history']) {
      requirePass((await api(prefix+'/'+probe+suffix, token)).status === 404, 'UNKNOWN_LOCATION_NOT_FOUND', report);
      requirePass((await api(foreignPrefix+'/'+probe+suffix, token)).status === 403, 'LOCATION_FOREIGN_DENIED', report);
    }
    for (const field of ['parent_id','exclude_subtree']) {
      requirePass((await api(prefix+'?'+field+'='+probe, token)).status === 404, 'UNKNOWN_LOCATION_FILTER_NOT_FOUND', report);
      requirePass((await api(foreignPrefix+'?'+field+'='+probe, token)).status === 403, 'LOCATION_FILTER_FOREIGN_DENIED', report);
    }

  } finally {
    config.password = '';
    if (authToken) {
      try { providerLogoutFailed = !(await auth('logout?scope=local', undefined, authToken)).ok; }
      catch { providerLogoutFailed = true; }
      report(`SUPABASE_SESSION_CLEANUP: ${providerLogoutFailed ? 'FAIL' : 'PASS'}`);
    }
    token = undefined; authToken = undefined;
  }
  if (providerLogoutFailed) throw new Error('Session cleanup failed');
  report('PHASE_6_READ_ONLY_VERIFICATION: PASS');
}
async function main() {
  if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error('Interactive terminal required');
  // readline echo goes to a sink; only explicit prompts/results go to the terminal.
  const sink = new Writable({ write(_chunk, _encoding, done) { done(); } });
  sink.isTTY = true;
  const rl = readline.createInterface({ input: process.stdin, output: sink, terminal: true });
  rl.on('SIGINT', () => { rl.close(); process.exitCode = 1; });
  const ask = label => new Promise(resolve => { process.stdout.write(label); rl.question('', answer => { process.stdout.write('\n'); resolve(answer); }); });
  try {
    console.log('LOCATIONS_VERIFICATION_VERSION: 1');
    console.log('Supabase/Railway login verification. All input is hidden. Only status and allowlisted error codes are printed.');
    const key = (await ask('Supabase publishable key (sb_publishable_..., NOT secret/service_role): ')).trim();
    if (!key.startsWith('sb_publishable_')) throw new Error('Publishable key required');
    const email = (await ask('Login email: ')).trim();
    const password = await ask('Password: ');
    const companyName = (await ask('Company name: ')).trim();
    const isolationCompanyId = (await ask('Existing isolation fixture company ID: ')).trim();
    rl.close();
    await verify({ ...defaults, key, email, password, companyName, isolationCompanyId });
  } finally { rl.close(); }
}
module.exports = { verify };
if (require.main === module) main().catch(() => { console.error('VERIFICATION_STOPPED: Check the last result; no secrets printed.'); process.exitCode = 1; });
