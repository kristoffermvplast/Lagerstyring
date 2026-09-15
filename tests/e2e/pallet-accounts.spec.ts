import {test,expect,Page} from '@playwright/test';
const company='10000000-0000-4000-8000-000000000001',other='10000000-0000-4000-8000-000000000002',id='50000000-0000-4000-8000-000000000001';
async function fixture(page:Page,write=true){
 const user='20000000-0000-4000-8000-000000000001',payload=Buffer.from(JSON.stringify({sub:user,exp:Math.floor(Date.now()/1000)+3600,role:'authenticated'})).toString('base64url');
 const session={access_token:`e30.${payload}.fixture`,refresh_token:'local-refresh',token_type:'bearer',expires_in:3600,expires_at:Math.floor(Date.now()/1000)+3600,user:{id:user,aud:'authenticated',email:'fixture@example.test',user_metadata:{},app_metadata:{},created_at:new Date().toISOString()}};
 await page.route('http://127.0.0.1:54321/auth/v1/**',r=>r.fulfill({status:200,json:session}));
 await page.route('**/api/me',r=>r.fulfill({json:{user:{id:user},memberships:[{company_id:company,name:'Test A'},{company_id:other,name:'Test B'}]}}));
 await page.route('**/api/companies/*/access',r=>r.fulfill({json:{permissions:['pallets.read','masterdata.read',...(write?['pallets.manage','pallets.adjust']:[])].map(code=>({code}))}}));
 await page.route(/\/api\/companies\/[^/]+\/masterdata/,r=>r.fulfill({json:{items:[{id,code:'P',name:'Fixture',active:true}],total:1}}));
 const bodies:any[]=[];
 await page.route(/\/api\/companies\/[^/]+\/pallet-accounts/,r=>{if(r.request().method()==='POST'){bodies.push(r.request().postDataJSON());return r.fulfill({status:bodies.length===1?503:201,json:bodies.length===1?{message:'Unavailable'}:{id}});}return r.fulfill({json:{items:r.request().url().includes(other)?[]:[{company_id:company,customer_id:id,supplier_id:null,pallet_type_id:id,quantity:'-3',snapshot:{party:{name:'Fixture',kind:'customer'},type:{name:'Reusable'}}}],total:r.request().url().includes(other)?0:1}});});
 await page.addInitScript(s=>sessionStorage.setItem('lager-auth-session',JSON.stringify(s)),session);await page.goto('/');await page.getByRole('button',{name:'Pallemellemværender',exact:true}).click();return bodies;
}
test('pallet balances explain direction and company switch clears results; reader cannot write',async({page})=>{
 await fixture(page,false);await expect(page.getByRole('cell',{name:'Vi skylder modpart',exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'Ny pallebevægelse'})).toHaveCount(0);
 await page.getByLabel('Virksomhed',{exact:true}).selectOption(other);await page.getByRole('button',{name:'Pallemellemværender',exact:true}).click();await expect(page.getByText('Ingen pallebevægelser fundet.')).toBeVisible();
});
test('movement confirms debt-only change and retries identical payload after uncertainty',async({page})=>{
 const bodies=await fixture(page);await page.getByRole('button',{name:'Ny pallebevægelse',exact:true}).click();await page.getByLabel('Modpart',{exact:true}).selectOption(id);await page.getByLabel('Emballagetype',{exact:true}).selectOption(id);await page.getByLabel('Antal stk.',{exact:true}).fill('12');await page.getByLabel('Dato',{exact:true}).fill('2026-09-15');await page.getByLabel('Begrundelse / kommentar').fill('Manual movement');
 let dialogs=0;page.on('dialog',d=>{expect(d.message()).toContain('Fysisk lager ændres ikke');dialogs++;void d.accept();});await page.getByRole('button',{name:'Bogfør pallebevægelse'}).click();await expect(page.getByRole('alert')).toBeVisible();await expect(page.getByLabel('Antal stk.',{exact:true})).toBeDisabled();await page.getByRole('button',{name:'Prøv samme bevægelse igen'}).click();await expect.poll(()=>bodies.length).toBe(2);expect(bodies[0]).toEqual(bodies[1]);expect(dialogs).toBe(1);
});
