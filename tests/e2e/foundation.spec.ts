import { test, expect } from '@playwright/test';

test('login screen is accessible and responsive without fictional business data', async ({ page }, testInfo) => {
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto('/');
  await expect(page.getByRole('heading',{name:'Velkommen tilbage'})).toBeVisible();
  await expect(page.getByLabel('E-mail',{exact:true})).toBeVisible();
  await expect(page.getByLabel('Adgangskode',{exact:true})).toHaveAttribute('type','password');
  await expect(page.getByRole('button',{name:'Log ind',exact:true})).toBeVisible();
  await expect(page.getByText('API svarer',{exact:true})).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(page.viewportSize()!.width);
  expect(errors).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath('login.png'), fullPage: true });
});
test('API failure is shown honestly',async({page})=>{
 await page.route('**/api/health/live',route=>route.fulfill({status:503,body:'{}'}));
 await page.goto('/');await expect(page.getByText('API kan ikke nås',{exact:true})).toBeVisible();
});
