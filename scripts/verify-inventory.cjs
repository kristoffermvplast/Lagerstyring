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
    requirePass(['inventory.read','inventory.adjust'].every(code => permissions.permissions?.some(p => p.code === code)), 'INVENTORY_PERMISSIONS', report);
    const foreign = config.isolationCompanyId;
    requirePass(typeof foreign === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(foreign) &&
      foreign !== membership.company_id && !me.memberships.some(m => m.company_id === foreign), 'ISOLATION_PRECONDITIONS', report);
    const prefix = `/companies/${membership.company_id}/inventory`;
    const foreignPrefix = `/companies/${foreign}/inventory`;
    for (const route of ['balances','entries','owners']) {
      const response=await api(prefix+'/'+route+'?limit=1',token);
      requirePass(response.status===200,route.toUpperCase()+'_READ',report);
      const body=await response.json();
      requirePass(Array.isArray(body.items)&&body.items.every(row=>row.company_id===membership.company_id),route.toUpperCase()+'_SCOPE',report);
      requirePass((await api(foreignPrefix+'/'+route,token)).status===403,route.toUpperCase()+'_FOREIGN_DENIED',report);
      if(route==='entries') {
        if(body.items[0]) {
          const detail=await api(prefix+'/entries/'+body.items[0].id,token);
          requirePass(detail.status===200,'ENTRY_DETAIL_READ',report);
          const data=await detail.json();
          requirePass(data.company_id===membership.company_id&&Array.isArray(data.lines)&&data.lines.length>0&&data.lines.every(l=>l.company_id===membership.company_id&&typeof l.quantity==='string'&&l.snapshot),'ENTRY_LINES_SCOPE',report);
        } else report('INVENTORY_EXISTING_ENTRY: NOT_RUN (no existing entry; no fixture created)');
      }
    }
    const probe='00000000-0000-4000-8000-000000000000';
    for(const route of ['entries/'+probe,'owners/'+probe+'/history']) {
      requirePass((await api(prefix+'/'+route,token)).status===404,'UNKNOWN_INVENTORY_RECORD_NOT_FOUND',report);
      requirePass((await api(foreignPrefix+'/'+route,token)).status===403,'INVENTORY_DETAIL_FOREIGN_DENIED',report);
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
  report('PHASE_7_READ_ONLY_VERIFICATION: PASS');
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
    console.log('INVENTORY_VERIFICATION_VERSION: 1');
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
