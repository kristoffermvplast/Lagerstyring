import {test,expect} from '@playwright/test';
const user='20000000-0000-4000-8000-000000000001';const company='10000000-0000-4000-8000-000000000001';
// Browser contracts use explicit local fixtures; API/RLS are covered separately by real NestJS + PGlite.
test('login, profile, no cross-tenant UI data and logout',async({page})=>{
 const payload=Buffer.from(JSON.stringify({sub:user,exp:Math.floor(Date.now()/1000)+3600,role:'authenticated'})).toString('base64url');
 const session={access_token:`e30.${payload}.fixture`,refresh_token:'local-test-refresh',token_type:'bearer',expires_in:3600,user:{id:user,aud:'authenticated',email:'operator@example.test',user_metadata:{},app_metadata:{},created_at:new Date().toISOString()}};
 await page.route('http://127.0.0.1:54321/auth/v1/**',async route=>{
  if(route.request().method()==='OPTIONS')return route.fulfill({status:204,headers:{'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'*','Access-Control-Allow-Methods':'POST,GET,OPTIONS'}});
  await route.fulfill({status:200,contentType:'application/json',headers:{'Access-Control-Allow-Origin':'*'},body:JSON.stringify(route.request().url().includes('/token')?session:{})});
 });
 await page.route('**/api/me',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({user:{id:user,display_name:'Test operator',email:'operator@example.test'},memberships:[{company_id:company,name:'Isolation A',role_id:'test-role'}]})}));
 await page.route('**/api/companies/*/access',route=>route.fulfill({status:200,contentType:'application/json',body:'{"permissions":[]}'}));
 await page.route('**/api/auth/logout',route=>route.fulfill({status:201,contentType:'application/json',body:'{"revoked":true}'}));
 await page.goto('/');await page.getByLabel('E-mail',{exact:true}).fill('operator@example.test');await page.getByLabel('Adgangskode',{exact:true}).fill('fixture-password-only');
 await page.getByRole('button',{name:'Log ind',exact:true}).click();
 await expect(page.getByRole('heading',{name:'Overblik',exact:true})).toBeVisible();
 await expect(page.getByRole('button',{name:'Adgang',exact:true})).toHaveCount(0);
 await expect(page.getByLabel('Virksomhed',{exact:true})).toHaveValue(company);
 await page.getByRole('button',{name:'Min profil',exact:true}).click();await expect(page.getByLabel('Dit navn')).toHaveValue('Test operator');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(page.viewportSize()!.width);
 await page.getByRole('button',{name:'Log ud',exact:true}).click();await expect(page.getByRole('heading',{name:'Velkommen tilbage'})).toBeVisible();
 expect(await page.evaluate(()=>sessionStorage.getItem('lager-auth-session'))).toBeNull();
});
