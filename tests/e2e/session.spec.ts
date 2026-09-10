import { test, expect, type Page } from '@playwright/test';

// Only local Auth/API fixtures. These exercise the real browser SDK, not hosted Supabase.
const userId = '20000000-0000-4000-8000-000000000001';
const companyA = '10000000-0000-4000-8000-000000000001';
const companyB = '10000000-0000-4000-8000-000000000002';
const user = { id: userId, aud: 'authenticated', email: 'session@example.test', user_metadata: {}, app_metadata: {}, created_at: '2026-01-01T00:00:00Z' };
function session(seconds = 3600) {
  const expires_at = Math.floor(Date.now() / 1000) + seconds;
  const payload = Buffer.from(JSON.stringify({ sub: userId, exp: expires_at, role: 'authenticated' })).toString('base64url');
  return { access_token: `e30.${payload}.fixture`, refresh_token: 'local-refresh-fixture', token_type: 'bearer', expires_in: seconds, expires_at, user };
}
async function fixture(page: Page, options: { expired?: boolean; rejectRefresh?: boolean; rejectLogout?: boolean; twoCompanies?: boolean } = {}) {
  const fresh = session();
  const calls = { refresh: 0, me: 0, bearer: '' };
  await page.route('http://127.0.0.1:54321/auth/v1/**', async route => {
    const headers = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS' };
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
    if (route.request().url().includes('grant_type=refresh_token')) {
      calls.refresh++;
      if (options.rejectRefresh) return route.fulfill({ status: 400, headers, contentType: 'application/json', body: JSON.stringify({ code: 'refresh_token_not_found', msg: 'Local fixture expired' }) });
    }
    return route.fulfill({ status: 200, headers, contentType: 'application/json', body: JSON.stringify(route.request().url().includes('/token') ? fresh : user) });
  });
  await page.route('**/api/me', route => {
    calls.me++; calls.bearer = route.request().headers().authorization ?? '';
    return route.fulfill({ json: { user: { id: userId, display_name: 'Session fixture', email: user.email }, memberships: [
      { company_id: companyA, name: 'Isolation A', role_id: 'admin-a' },
      ...(options.twoCompanies ? [{ company_id: companyB, name: 'Isolation B', role_id: 'reader-b' }] : []),
    ] } });
  });
  await page.route('**/api/companies/*/access', route => route.fulfill({ json: { permissions: options.twoCompanies && route.request().url().includes(companyA) ? [{ code: 'access.read' }, { code: 'access.manage' }] : [] } }));
  await page.route('**/api/companies/*/members', route => route.fulfill({ json: [{ user_id: userId, display_name: 'Only company A member', role_id: 'admin-a', active: true, version: 1 }] }));
  await page.route('**/api/companies/*/roles', route => route.fulfill({ json: [{ id: 'admin-a', name: 'Administrator A', is_admin: true, permissions: [] }] }));
  await page.route('**/api/companies/*/access-audit', route => route.fulfill({ json: [] }));
  await page.route('**/api/auth/logout', route => route.fulfill({ status: options.rejectLogout ? 503 : 201, json: options.rejectLogout ? {} : { revoked: true } }));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Velkommen tilbage' })).toBeVisible();
  await page.evaluate(value => sessionStorage.setItem('lager-auth-session', JSON.stringify(value)), options.expired ? session(-300) : fresh);
  await page.reload();
  return { calls, fresh };
}

test('session survives reload without storing it in localStorage', async ({ page }) => {
  await fixture(page);
  await expect(page.getByRole('heading', { name: 'Overblik', exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Overblik', exact: true })).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('lager-auth-session'))).toBeNull();
});

test('expired access token is refreshed before protected API requests', async ({ page }) => {
  const { calls, fresh } = await fixture(page, { expired: true });
  await expect(page.getByRole('heading', { name: 'Overblik', exact: true })).toBeVisible();
  await expect.poll(() => calls.me).toBeGreaterThan(0);
  expect(calls.refresh).toBeGreaterThan(0);
  expect(calls.bearer === `Bearer ${fresh.access_token}`).toBe(true);
});

test('invalid refresh token returns to login without protected API access', async ({ page }) => {
  const { calls } = await fixture(page, { expired: true, rejectRefresh: true });
  await expect(page.getByRole('heading', { name: 'Velkommen tilbage' })).toBeVisible();
  expect(calls.refresh).toBeGreaterThan(0);
  expect(calls.me).toBe(0);
  expect(await page.evaluate(() => sessionStorage.getItem('lager-auth-session'))).toBeNull();
});

test('failed server logout offers local closure that survives reload', async ({ page }) => {
  await fixture(page, { rejectLogout: true });
  await expect(page.getByRole('heading', { name: 'Overblik', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Log ud', exact: true }).click();
  await expect(page.getByText('Serverens logout er ikke bekræftet, hvis forbindelsen fejlede.')).toBeVisible();
  await page.getByRole('button', { name: 'Luk kun sessionen på denne enhed' }).click();
  await expect(page.getByRole('heading', { name: 'Velkommen tilbage' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Velkommen tilbage' })).toBeVisible();
});

test('switching company removes previous company members and management controls', async ({ page }, testInfo) => {
  await fixture(page, { twoCompanies: true });
  await page.getByRole('button', { name: 'Adgang', exact: true }).click();
  await expect(page.getByText('Only company A member', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Tilføj medlem' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(page.viewportSize()!.width);
  const roleBounds = await page.getByLabel(`Rolle for ${userId}`, { exact: true }).boundingBox();
  expect(roleBounds?.width).toBeGreaterThanOrEqual(170);
  await page.screenshot({ path: testInfo.outputPath('access.png'), fullPage: true });
  await page.getByLabel('Virksomhed', { exact: true }).selectOption(companyB);
  await expect(page.getByText('Du er logget ind hos Isolation B.', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Adgang', exact: true })).toHaveCount(0);
  await expect(page.getByText('Only company A member', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Tilføj medlem' })).toHaveCount(0);
});
