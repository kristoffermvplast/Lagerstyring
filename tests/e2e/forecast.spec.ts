import {test,expect,Page} from '@playwright/test';
const company='10000000-0000-4000-8000-000000000001',other='10000000-0000-4000-8000-000000000002',item='50000000-0000-4000-8000-000000000001',owner='50000000-0000-4000-8000-000000000002',order='50000000-0000-4000-8000-000000000003',reservation='50000000-0000-4000-8000-000000000004';
async function fixture(page:Page,allowed=true){
 const user='20000000-0000-4000-8000-000000000001',payload=Buffer.from(JSON.stringify({sub:user,exp:Math.floor(Date.now()/1000)+3600,role:'authenticated'})).toString('base64url');
 const session={access_token:`e30.${payload}.fixture`,refresh_token:'local-refresh',token_type:'bearer',expires_in:3600,expires_at:Math.floor(Date.now()/1000)+3600,user:{id:user,aud:'authenticated',email:'fixture@example.test',user_metadata:{},app_metadata:{},created_at:new Date().toISOString()}};
 await page.route('http://127.0.0.1:54321/auth/v1/**',r=>r.fulfill({json:session}));
 await page.route('**/api/me',r=>r.fulfill({json:{user:{id:user},memberships:[{company_id:company,name:'Test A'},{company_id:other,name:'Test B'}]}}));
 await page.route('**/api/companies/*/access',r=>r.fulfill({json:{permissions:['inventory.read','masterdata.read','production.read',...(allowed?['shipments.read']:[])].map(code=>({code}))}}));
 const requests:any[]=[];let fail=false;
 await page.route('**/forecast/options?*',r=>r.fulfill({json:{company_id:company,items:[{id:item,code:'MAT',name:'Material'}],owners:[{id:owner,code:'OWN',name:'Own stock'}],orders:[{id:order,code:'ORDER-1',status:'planned'}],reservations:[{id:reservation,reference:'RES-1',quantity:'2'}],more_items:false}}));
 await page.route('**/forecast/preview',r=>{requests.push(r.request().postDataJSON());return fail?r.fulfill({status:503,json:{}}):r.fulfill({json:{company_id:r.request().url().includes(other)?other:company,as_of:new Date().toISOString(),sha256:'a'.repeat(64),item:{id:item,code:'MAT',name:'Material',symbol:'kg'},owner:{id:owner,code:'OWN',name:'Own stock'},physical:'10',reserved:'2',in_production:'3',planning_available:'5',expected_arrivals:'0',remaining_demand:'4',reservation_credit:'2',projected_available:'3',shortage:'0',assumptions:['Kun valgt ejer.'],timeline:[{kind:'production',source_id:order,reference:'ORDER-1',date:'2026-09-22',quantity:'4',reservation_credit:'2',projected_available:'3'}],sources:{}}});});
 await page.addInitScript(s=>sessionStorage.setItem('lager-auth-session',JSON.stringify(s)),session);await page.goto('/');
 return{requests,fail:()=>{fail=true;}};
}
test('requires all source permissions before showing forecast navigation',async({page})=>{await fixture(page,false);await expect(page.getByRole('button',{name:'Lager',exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'Prognose',exact:true})).toHaveCount(0);});
test('calculates explicit production/reservation choices and downloads traceable evidence',async({page})=>{
 const f=await fixture(page);await page.getByRole('button',{name:'Prognose',exact:true}).click();await page.getByLabel('Vare',{exact:true}).selectOption(item);await page.getByLabel('Lagerejer').selectOption(owner);
 await page.getByText('Produktionsbehov og reservationer',{exact:true}).click();await page.getByLabel('ORDER-1',{exact:true}).check();await page.getByLabel('RES-1 · 2',{exact:true}).check();await page.getByRole('button',{name:'Beregn prognose',exact:true}).click();
 await expect(page.getByRole('region',{name:'Prognoseresultat'})).toContainText('Forventet disponibelt: 3 kg');expect(f.requests[0]).toMatchObject({item_id:item,owner_id:owner,production_order_ids:[order],production_reservation_ids:[reservation],arrivals:[]});
 const download=page.waitForEvent('download');await page.getByRole('button',{name:'Hent beregningsgrundlag'}).click();expect((await download).suggestedFilename()).toBe('prognose-'+ 'a'.repeat(12)+'.json');
 await page.getByLabel('ORDER-1',{exact:true}).uncheck();await expect(page.getByRole('region',{name:'Prognoseresultat'})).toHaveCount(0);
});
test('keeps optional arrivals separate, hides stale results on failure and resets when changing company',async({page})=>{
 const f=await fixture(page);await page.getByRole('button',{name:'Prognose',exact:true}).click();await page.getByLabel('Vare',{exact:true}).selectOption(item);await page.getByLabel('Lagerejer').selectOption(owner);
 await page.getByText('Forventede leverancer (valgfrit)',{exact:true}).click();await page.getByRole('button',{name:'Tilføj forventet leverance'}).click();await page.getByLabel('Leveringsreference').fill('INBOUND');await page.getByLabel('Forventet mængde').fill('2.00000001');await page.getByRole('button',{name:'Beregn prognose',exact:true}).click();await expect(page.getByRole('region',{name:'Prognoseresultat'})).toBeVisible();expect(f.requests[0].arrivals[0].quantity).toBe('2.00000001');
 f.fail();await page.getByRole('button',{name:'Beregn prognose',exact:true}).click();await expect(page.getByRole('alert')).toBeVisible();await expect(page.getByRole('button',{name:'Hent beregningsgrundlag'})).toHaveCount(0);
 await page.getByLabel('Virksomhed',{exact:true}).selectOption(other);await page.getByRole('button',{name:'Prognose',exact:true}).click();await expect(page.getByLabel('Vare',{exact:true})).toHaveValue('');await expect(page.getByLabel('Lagerejer')).toHaveValue('');await expect(page.getByLabel('Leveringsreference')).toHaveCount(0);
});
