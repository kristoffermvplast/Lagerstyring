import {chooseReference} from './ux-helpers';
import {openWorkspace} from './ux-helpers';
import {test,expect,Page} from '@playwright/test';
const company='10000000-0000-4000-8000-000000000001',other='10000000-0000-4000-8000-000000000002';
async function fixture(page:Page,receive=true){
 const user='20000000-0000-4000-8000-000000000001';const payload=Buffer.from(JSON.stringify({sub:user,exp:Math.floor(Date.now()/1000)+3600,role:'authenticated'})).toString('base64url');
 const session={access_token:`e30.${payload}.fixture`,refresh_token:'local-refresh',token_type:'bearer',expires_in:3600,expires_at:Math.floor(Date.now()/1000)+3600,user:{id:user,aud:'authenticated',email:'fixture@example.test',user_metadata:{},app_metadata:{},created_at:new Date().toISOString()}};
 await page.route('http://127.0.0.1:54321/auth/v1/**',r=>r.fulfill({status:200,headers:{'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'*'},json:session}));
 await page.route('**/api/me',r=>r.fulfill({json:{user:{id:user,display_name:'Fixture'},memberships:[{company_id:company,name:'Test A'},{company_id:other,name:'Test B'}]}}));
 await page.route('**/api/companies/*/access',r=>r.fulfill({json:{permissions:[{code:'inventory.read'},{code:'masterdata.read'},{code:'masterdata.manage'},...(receive?[{code:'inventory.receive'}]:[])]}}));
 const row={id:'50000000-0000-4000-8000-000000000001',code:'CODE',name:'Fixture',active:true,kind:'company',notes:'',version:1};const bodies:any[]=[];
 await page.route(/\/api\/companies\/[^/]+\/(items|locations)/,r=>r.fulfill({json:r.request().url().includes(row.id)?{...row,path:[row],unit_id:row.id,supplier_id:row.id,standard_location_id:row.id}:{items:[row],total:1}}));
 await page.route(/\/api\/companies\/[^/]+\/inventory/,async r=>{
  const url=new URL(r.request().url());if(r.request().method()==='POST'){bodies.push(r.request().postDataJSON());if(bodies.length===1)return r.fulfill({status:503,json:{message:'Unavailable'}});return r.fulfill({status:201,json:{id:'entry'}});}
  if(url.pathname.endsWith('/history'))return r.fulfill({json:[]});
  const items=url.pathname.endsWith('/owners')?[row]:url.pathname.includes(other)?[]:url.pathname.endsWith('/balances')?[{quantity:'12.00000000',snapshot:{item:{code:'MAT',name:'Material'},owner:{name:'Company stock'},location:{name:'Shelf'},unit:{symbol:'kg'}}}]:[];
  return r.fulfill({json:{items,total:items.length}});
 });
 await page.route(/\/api\/companies\/[^/]+\/masterdata/,r=>r.fulfill({json:r.request().url().includes('/units/')?{...row,symbol:'kg',dimension:'mass'}:{items:[row],total:1}}));
 await page.route(/\/api\/companies\/[^/]+\/receipts/,async r=>{
  if(r.request().method()==='POST'){bodies.push(r.request().postDataJSON());return r.fulfill({status:bodies.length===1?503:201,json:bodies.length===1?{message:'Unavailable'}:{id:'receipt'}});}
  return r.fulfill({json:{items:[],total:0}});
 });
 await page.addInitScript(s=>sessionStorage.setItem('lager-auth-session',JSON.stringify(s)),session);
 await page.goto('/');await openWorkspace(page,'Modtagelse');return{row,bodies};
}
test('grouped navigation keeps QR direct, hides unavailable areas and follows company changes',async({page})=>{
 await fixture(page);
 await expect(page.getByRole('button',{name:'Lager — menu'})).toHaveAttribute('aria-expanded','true');
 await expect(page.getByRole('button',{name:'Stamdata — menu'})).toHaveAttribute('aria-expanded','false');
 await expect(page.getByRole('button',{name:'Scan QR',exact:true})).toBeVisible();
 await expect(page.getByRole('button',{name:'Produktion',exact:true,includeHidden:true})).toHaveCount(0);
 await openWorkspace(page,'Kunder');await expect(page.locator('#content')).toBeFocused();
 await expect(page.getByRole('button',{name:'Kunder',exact:true})).toHaveAttribute('aria-current','page');
 await page.getByLabel('Virksomhed',{exact:true}).selectOption(other);
 await expect(page.getByRole('heading',{name:'Overblik',exact:true})).toBeVisible();
 await expect(page.getByRole('button',{name:'Overblik — menu'})).toHaveAttribute('aria-expanded','true');
});
test('catalog filters remain effective when folded and required controls have visible borders',async({page})=>{
 await fixture(page);await openWorkspace(page,'Kunder');
 await expect(page.getByRole('combobox',{name:'Status',exact:true,includeHidden:true})).not.toBeVisible();
 await page.getByText('Filtre og sortering',{exact:true}).click();
 const request=page.waitForRequest(r=>r.url().includes('/masterdata/customers?')&&r.url().includes('active=false'));
 await page.getByRole('combobox',{name:'Status',exact:true,includeHidden:true}).selectOption('false');await request;
 await page.getByText('Filtre og sortering · ændret',{exact:true}).click();
 await expect(page.getByRole('combobox',{name:'Status',exact:true,includeHidden:true})).toHaveValue('false');
 await page.getByRole('button',{name:'Opret ny'}).click();
 const field=page.getByLabel('Nummer / kode',{exact:true});
 await expect(field).toHaveAttribute('required','');
 expect(await field.evaluate(el=>parseFloat(getComputedStyle(el).borderTopWidth))).toBeGreaterThan(0);
});
test('reference search distinguishes failure, empty results and keyboard selection without committing search text',async({page})=>{
 const {row}=await fixture(page);await page.getByRole('button',{name:'Ny modtagelse'}).click();
 await page.route(/\/api\/companies\/[^/]+\/inventory\/owners/,r=>{
 const q=new URL(r.request().url()).searchParams.get('q');
 return r.fulfill(q==='error'?{status:500,json:{message:'Unavailable'}}:{json:{items:q==='missing'?[]:[row],total:q==='missing'?0:1}});
 });
 const field=page.getByRole('combobox',{name:'Ejer',exact:true});await field.fill('missing');
 await expect(page.getByText('Ingen resultater. Prøv en anden søgning.')).toBeVisible();
 await field.fill('error');await expect(page.getByRole('button',{name:'Prøv opslag igen'})).toBeVisible();
 await field.fill('Fixture');await expect(page.getByRole('listbox',{name:'Ejer',exact:true}).getByRole('option',{name:'CODE · Fixture',exact:true})).toBeVisible();
 await field.press('ArrowDown');await field.press('Enter');
 await expect(page.getByLabel('Ejer (valgt værdi)',{exact:true})).toHaveValue(row.id);
 await field.fill('missing');await field.press('Escape');
 await expect(field).toHaveValue('CODE · Fixture');
 await expect(page.getByLabel('Ejer (valgt værdi)',{exact:true})).toHaveValue(row.id);
 await page.getByRole('button',{name:'Ryd ejer'}).click();
 await expect(page.getByLabel('Ejer (valgt værdi)',{exact:true})).toHaveValue('');
});
test('search text without a selection cannot submit a receipt',async({page})=>{
 const {row,bodies}=await fixture(page);await page.getByRole('button',{name:'Ny modtagelse'}).click();
 await chooseReference(page,'Vare',row.id);
 await page.getByRole('combobox',{name:'Ejer',exact:true}).fill('Not a selected owner');
 await page.getByLabel('Modtaget mængde').fill('1');
 await page.getByRole('button',{name:'Bekræft modtagelse'}).click();
 await expect(page.getByText('Vælg ejer fra listen.',{exact:true})).toBeVisible();
 expect(bodies).toHaveLength(0);
});
