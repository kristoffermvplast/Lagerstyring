import { test, expect } from '@playwright/test';

test('foundation layout is usable without fictional inventory', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Overblik', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Et rent udgangspunkt' })).toBeVisible();
  await expect(page.getByRole('status')).toHaveText('API svarer');
  await page.getByRole('button', { name: 'Om arbejdsrummet' }).click();
  await expect(page.locator('#about-workspace')).toBeVisible();
  await page.getByRole('button', { name: 'Om arbejdsrummet' }).click();
  await expect(page.locator('#about-workspace')).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  const menu = page.getByRole('button', { name: 'Åbn navigation' });
  if (await menu.isVisible()) {
    await menu.click();
    await expect(page.getByRole('navigation', { name: 'Hovednavigation' })).toBeInViewport();
    await expect(page.getByRole('navigation').getByRole('button', { name: 'Varer', exact: true })).toBeDisabled();
    await page.getByRole('button', { name: 'Luk navigation' }).click();
    await expect(menu).toHaveAttribute('aria-expanded', 'false');
  } else {
    await expect(page.getByRole('navigation').getByRole('button', { name: 'Varer', exact: true })).toBeDisabled();
  }
  expect(errors).toEqual([]);
});

test('API failure is shown honestly', async ({ page }) => {
  await page.route('**/api/health/live', route => route.fulfill({ status: 503, body: '{}' }));
  await page.goto('/');
  await expect(page.getByRole('status')).toHaveText('API kan ikke nås');
});
