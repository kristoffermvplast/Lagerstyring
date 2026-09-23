import {chooseReference} from './ux-helpers';
import {openWorkspace} from './ux-helpers';
import {test,expect,Page} from '@playwright/test';
const company='10000000-0000-4000-8000-000000000001',other='10000000-0000-4000-8000-000000000002';
async function fixture(page:Page,transfer=true){
 const user='20000000-0000-4000-8000-000000000001';const payload=Buffer.from(JSON.stringify({sub:user,exp:Math.floor(Date.now()/1000)+3600,role:'authenticated'})).toString('base64url');
 const session={access_token:`e30.${payload}.fixture`,refresh_token:'local-refresh',token_type:'bearer',expires_in:3600,expires_at:Math.floor(Date.now()/1000)+3600,user:{id:user,aud:'authenticated',email:'fixture@example.test',user_metadata:{},app_metadata:{},created_at:new Date().toISOString()}};
 await page.route('http://127.0.0.1:54321/auth/v1/**',r=>r.fulfill({status:200,headers:{'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'*'},json:session}));
 await page.route('**/api/me',r=>r.fulfill({json:{user:{id:user,display_name:'Fixture'},memberships:[{company_id:company,name:'Test A'},{company_id:other,name:'Test B'}]}}));
 await page.route('**/api/companies/*/access',r=>r.fulfill({json:{permissions:[{code:'shipments.read'},{code:'inventory.read'},{code:'masterdata.read'},...(transfer?[{code:'shipments.manage'},{code:'shipments.dispatch'},{code:'inventory.reserve'}]:[])]}}));
 const row={id:'50000000-0000-4000-8000-000000000001',code:'CODE',name:'Fixture',active:true,kind:'company',notes:'',version:1};const bodies:any[]=[];
 await page.route(/\/api\/companies\/[^/]+\/(items|locations)/,r=>r.fulfill({json:r.request().url().includes(row.id)?{...row,path:[row],unit_id:row.id,supplier_id:row.id,standard_location_id:row.id}:{items:[row],total:1}}));
 await page.route(/\/api\/companies\/[^/]+\/inventory/,async r=>{
  const url=new URL(r.request().url());if(r.request().method()==='POST'){bodies.push(r.request().postDataJSON());if(bodies.length===1)return r.fulfill({status:503,json:{message:'Unavailable'}});return r.fulfill({status:201,json:{id:'entry'}});}
  if(url.pathname.endsWith('/history'))return r.fulfill({json:[]});
  const items=url.pathname.endsWith('/owners')?[row]:url.pathname.includes(other)?[]:url.pathname.endsWith('/balances')?[{item_id:row.id,owner_id:row.id,location_id:'60000000-0000-4000-8000-000000000001',quantity:'12.00000000',snapshot:{item:{code:'MAT',name:'Material'},owner:{name:'Company stock'},location:{name:'Shelf'},unit:{symbol:'kg'}}}]:[];
  return r.fulfill({json:{items,total:items.length}});
 });
 await page.route(/\/api\/companies\/[^/]+\/masterdata/,r=>r.fulfill({json:r.request().url().includes('/units/')?{...row,symbol:'kg',dimension:'mass'}:{items:[row],total:1}}));
 await page.route(/\/api\/companies\/[^/]+\/shipments/,async r=>{
  if(r.request().method()==='POST'){bodies.push(r.request().postDataJSON());return r.fulfill({status:bodies.length===1?503:201,json:bodies.length===1?{message:'Unavailable'}:{id:'50000000-0000-4000-8000-000000000099'}});}
  if(new URL(r.request().url()).pathname.split('/').length>5)return r.fulfill({status:404,json:{message:'Not found'}});
  return r.fulfill({json:{items:[],total:0}});
 });
 await page.route(/\/api\/companies\/[^/]+\/recipes/,r=>r.fulfill({json:[]}));
 await page.addInitScript(s=>sessionStorage.setItem('lager-auth-session',JSON.stringify(s)),session);
 await page.goto('/');await openWorkspace(page,'Forsendelser');return{row,bodies};
}

test('read-only shipment access hides creation and company switch clears state',async({page})=>{
 await fixture(page,false);await expect(page.getByText('Ingen forsendelser fundet.')).toBeVisible();await expect(page.getByRole('button',{name:'Ny forsendelse'})).toHaveCount(0);
 await page.getByLabel('Virksomhed',{exact:true}).selectOption(other);await openWorkspace(page,'Forsendelser');await expect(page.getByText('Ingen forsendelser fundet.')).toBeVisible();
});
test('draft creation uses backend and identical payload when retrying an uncertain response',async({page})=>{
 const {row,bodies}=await fixture(page);await page.getByRole('button',{name:'Ny forsendelse',exact:true}).click();
 await page.getByLabel('Forsendelsesnummer',{exact:true}).fill('SHIP-TEST');await chooseReference(page,'Kunde',row.id);await page.getByLabel('Forsendelsesdato',{exact:true}).fill('2026-09-16');
 await chooseReference(page,'Vare',row.id);await chooseReference(page,'Ejer',row.id);await page.getByLabel('Placering',{exact:true}).selectOption(row.id);
 await page.getByLabel('Mængde',{exact:true}).fill('1,00825001');await page.getByLabel('Begrundelse',{exact:true}).fill('Customer shipment');
 await page.getByRole('button',{name:'Gem kladde'}).click();await expect(page.getByRole('alert')).toBeVisible();await expect(page.getByLabel('Mængde',{exact:true})).toBeDisabled();
 // Do not fabricate a persisted detail after the retry; close is sufficient for this request-boundary test.
 await page.getByRole('button',{name:'Prøv samme kladde igen'}).click();await expect.poll(()=>bodies.length).toBe(2);expect(bodies[0]).toEqual(bodies[1]);expect(bodies[0].data.lines[0].quantity).toBe('1.00825001');
});
test('dispatch explicitly confirms stock reduction and retries the same command',async({page})=>{
 await fixture(page);const id='50000000-0000-4000-8000-000000000009';const cmds:any[]=[];
 const row={id,company_id:company,code:'SHIP-READY',status:'ready',version:4,ship_date:'2026-09-16',reference:'REF',carrier:'Carrier',notes:'',snapshot:{customer:{name:'Customer',address:'Address'}},lines:[],events:[],packing:{pallets:'1',pallet_spaces:'1',lines:[]}};
 await page.route(/\/api\/companies\/[^/]+\/shipments/,async r=>{if(r.request().method()==='POST'){cmds.push(r.request().postDataJSON());if(cmds.length===1)return r.fulfill({status:503,json:{message:'Unavailable'}});row.status='dispatched';row.version++;return r.fulfill({status:201,json:row});}return r.fulfill({json:r.request().url().includes(id)?row:{items:[row],total:1}});});
 await page.getByLabel('Søg forsendelse').fill('SHIP');await page.getByRole('button',{name:'Vis forsendelse'}).click();await page.getByLabel('Begrundelse for statusændring').fill('Truck departed');
 let confirmations=0;page.on('dialog',d=>{expect(d.message()).toContain('Fysisk lager reduceres');confirmations++;void d.accept();});await page.getByRole('button',{name:'Afsend forsendelse',exact:true}).click();await expect(page.getByRole('alert')).toBeVisible();await page.getByRole('button',{name:'Prøv samme kommando igen'}).click();await expect(page.getByRole('heading',{name:'SHIP-READY · Afsendt'})).toBeVisible();expect(cmds).toHaveLength(2);expect(cmds[0]).toEqual(cmds[1]);expect(confirmations).toBe(1);
});
