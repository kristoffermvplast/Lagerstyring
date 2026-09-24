import {chooseReference} from './ux-helpers';
import {openWorkspace} from './ux-helpers';
import {test,expect,Page} from '@playwright/test';
const company='10000000-0000-4000-8000-000000000001',other='10000000-0000-4000-8000-000000000002';
async function fixture(page:Page,receive=true){
 const user='20000000-0000-4000-8000-000000000001';const payload=Buffer.from(JSON.stringify({sub:user,exp:Math.floor(Date.now()/1000)+3600,role:'authenticated'})).toString('base64url');
 const session={access_token:`e30.${payload}.fixture`,refresh_token:'local-refresh',token_type:'bearer',expires_in:3600,expires_at:Math.floor(Date.now()/1000)+3600,user:{id:user,aud:'authenticated',email:'fixture@example.test',user_metadata:{},app_metadata:{},created_at:new Date().toISOString()}};
 await page.route('http://127.0.0.1:54321/auth/v1/**',r=>r.fulfill({status:200,headers:{'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'*'},json:session}));
 await page.route('**/api/me',r=>r.fulfill({json:{user:{id:user,display_name:'Fixture'},memberships:[{company_id:company,name:'Test A'},{company_id:other,name:'Test B'}]}}));
 await page.route('**/api/companies/*/access',r=>r.fulfill({json:{permissions:[{code:'inventory.read'},{code:'masterdata.read'},...(receive?[{code:'inventory.receive'}]:[])]}}));
 const row={id:'50000000-0000-4000-8000-000000000001',code:'CODE',name:'Fixture',active:true,is_storage:true,kind:'company',notes:'',version:1};const bodies:any[]=[];
 await page.route(/\/api\/companies\/[^/]+\/(items|locations)/,r=>r.fulfill({json:r.request().url().includes(row.id)?{...row,path:[row],unit_id:row.id,supplier_id:row.id,standard_location_id:row.id}:{items:[row],total:1}}));
 await page.route(/\/api\/companies\/[^/]+\/inventory/,async r=>{
  const url=new URL(r.request().url());if(r.request().method()==='POST'){bodies.push(r.request().postDataJSON());if(bodies.length===1)return r.fulfill({status:503,json:{message:'Unavailable'}});return r.fulfill({status:201,json:{id:'entry'}});}
  if(url.pathname.endsWith('/history'))return r.fulfill({json:[]});
  const items=url.pathname.endsWith('/owners')?[row]:url.pathname.includes(other)?[]:url.pathname.endsWith('/balances')?[{quantity:'12.00000000',snapshot:{item:{code:'MAT',name:'Material'},owner:{name:'Company stock'},location:{name:'Shelf'},unit:{symbol:'kg'}}}]:[];
  return r.fulfill({json:{items,total:items.length}});
 });
 await page.route(/\/api\/companies\/[^/]+\/masterdata/,r=>r.fulfill({json:r.request().url().includes('/units/')?{...row,symbol:'kg',dimension:'mass'}:r.request().url().includes('/suppliers/')?row:{items:[row],total:1}}));
 await page.route(/\/api\/companies\/[^/]+\/receipts/,async r=>{
  if(r.request().method()==='POST'){bodies.push(r.request().postDataJSON());return r.fulfill({status:bodies.length===1?503:201,json:bodies.length===1?{message:'Unavailable'}:{id:'receipt'}});}
  return r.fulfill({json:{items:[],total:0}});
 });
 await page.addInitScript(s=>sessionStorage.setItem('lager-auth-session',JSON.stringify(s)),session);
 await page.goto('/');await openWorkspace(page,'Modtagelse');return{row,bodies};
}
test('read-only user sees receipts without receiving action',async({page})=>{
 await fixture(page,false);await expect(page.getByText('Ingen modtagelser fundet.')).toBeVisible();await expect(page.getByRole('button',{name:'Ny modtagelse'})).toHaveCount(0);
 await page.getByLabel('Virksomhed',{exact:true}).selectOption(other);await openWorkspace(page,'Modtagelse');await expect(page.getByText('Ingen modtagelser fundet.')).toBeVisible();
});
test('receives exact decimal difference and retries the same immutable request',async({page})=>{
 const {row,bodies}=await fixture(page);await page.getByRole('button',{name:'Ny modtagelse'}).click();
 await chooseReference(page,'Vare',row.id);await chooseReference(page,'Ejer',row.id);
 await expect(page.getByText('Lagerenhed: kg')).toBeVisible();await expect(page.getByLabel('Placering',{exact:true})).toHaveValue(row.id);await page.getByText('Flere oplysninger',{exact:true}).click();await expect(page.getByLabel('Leverandør (valgt værdi)',{exact:true})).toHaveValue(row.id);
 await page.getByLabel('Forventet mængde').fill('10,00825001');await page.getByLabel('Modtaget mængde').fill('8,00000001');
 await expect(page.getByText('Difference: -2.00825000 kg · Afvigelse')).toBeVisible();
 await page.getByLabel('Antal paller').fill('2');await page.getByLabel('Reference',{exact:true}).fill('Local fixture');
 let confirms=0;page.on('dialog',d=>{expect(d.message()).toContain('Fysisk lager øges');confirms++;void d.accept();});
 await page.getByRole('button',{name:'Bekræft modtagelse'}).click();await expect(page.getByRole('alert')).toBeVisible();await expect(page.getByLabel('Modtaget mængde')).toBeDisabled();
 await page.getByRole('button',{name:'Prøv samme modtagelse igen'}).click();await expect(page.getByText('Modtagelsen er bogført på lageret.')).toBeVisible();
 expect(bodies).toHaveLength(2);expect(bodies[0]).toEqual(bodies[1]);expect(bodies[0].quantity).toBe('8.00000001');expect(bodies[0].expected_quantity).toBe('10.00825001');expect(bodies[0].pallet_count).toBe(2);expect(confirms).toBe(1);
});

test('stage3 single active owner is prefilled once; clear and multiple choices stay explicit',async({page})=>{
 const {row}=await fixture(page);await page.getByRole('button',{name:'Ny modtagelse',exact:true}).click();await expect(page.getByLabel('Ejer (valgt værdi)',{exact:true})).toHaveValue(row.id);
 await page.getByRole('button',{name:'Ryd ejer',exact:true}).click();await expect(page.getByLabel('Ejer (valgt værdi)',{exact:true})).toHaveValue('');await expect(page.getByLabel('Forventet mængde')).not.toBeVisible();await page.getByRole('button',{name:'Luk',exact:true}).click();
 await page.route('**/inventory/owners?*',r=>r.fulfill({json:{items:[row],total:2}}));await page.getByRole('button',{name:'Ny modtagelse',exact:true}).click();await expect(page.getByLabel('Ejer (valgt værdi)',{exact:true})).toHaveValue('');await page.getByRole('combobox',{name:'Ejer',exact:true}).fill('CODE');await expect(page.getByRole('listbox',{name:'Ejer',exact:true}).getByRole('option')).toHaveCount(1);await expect(page.getByLabel('Ejer (valgt værdi)',{exact:true})).toHaveValue('');
});
test('stage3 inactive defaults are not selected and item switch clears previous defaults',async({page})=>{
 const {row}=await fixture(page);await page.getByRole('button',{name:'Ny modtagelse',exact:true}).click();await chooseReference(page,'Vare',row.id);await expect(page.getByLabel('Placering',{exact:true})).toHaveValue(row.id);
 await page.getByRole('combobox',{name:'Varetype',exact:true}).selectOption('packaging');await expect(page.getByLabel('Placering',{exact:true})).toHaveValue('');
 await page.route('**/locations/'+row.id,r=>r.fulfill({json:{...row,active:false,is_storage:false,path:[row]}}));await page.route('**/masterdata/suppliers/'+row.id,r=>r.fulfill({json:{...row,active:false}}));
 const replies=Promise.all([page.waitForResponse(r=>r.url().endsWith('/locations/'+row.id)),page.waitForResponse(r=>r.url().endsWith('/suppliers/'+row.id))]);await chooseReference(page,'Vare',row.id);await replies;
 await page.getByText('Flere oplysninger',{exact:true}).click();await expect(page.getByLabel('Leverandør (valgt værdi)',{exact:true})).toHaveValue('');await expect(page.getByLabel('Placering',{exact:true})).toHaveValue('');
});
test('stage3 a delayed standard lookup never replaces a manual location or posts',async({page})=>{
 const {row,bodies}=await fixture(page);const alternate='60000000-0000-4000-8000-000000000002';let release:()=>void=()=>{};const gate=new Promise<void>(r=>release=r);let started=false;
 await page.route('**/locations?*',r=>r.fulfill({json:{items:[row,{...row,id:alternate,code:'ALT',name:'Anden placering'}],total:2}}));
 await page.route('**/locations/'+row.id,async r=>{started=true;await gate;await r.fulfill({json:{...row,is_storage:true,path:[row]}});});
 await page.getByRole('button',{name:'Ny modtagelse',exact:true}).click();await chooseReference(page,'Vare',row.id);await expect.poll(()=>started).toBe(true);await page.getByLabel('Placering',{exact:true}).selectOption(alternate);const response=page.waitForResponse(r=>r.url().endsWith('/locations/'+row.id));release();await (await response).finished();await page.getByText('Flere oplysninger',{exact:true}).click();await expect(page.getByLabel('Leverandør (valgt værdi)',{exact:true})).toHaveValue(row.id);await expect(page.getByLabel('Placering',{exact:true})).toHaveValue(alternate);expect(bodies).toHaveLength(0);
});
