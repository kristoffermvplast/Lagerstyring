import {test,expect,Page} from '@playwright/test';
const company='10000000-0000-4000-8000-000000000001',other='10000000-0000-4000-8000-000000000002';
async function fixture(page:Page,transfer=true){
 const user='20000000-0000-4000-8000-000000000001';const payload=Buffer.from(JSON.stringify({sub:user,exp:Math.floor(Date.now()/1000)+3600,role:'authenticated'})).toString('base64url');
 const session={access_token:`e30.${payload}.fixture`,refresh_token:'local-refresh',token_type:'bearer',expires_in:3600,expires_at:Math.floor(Date.now()/1000)+3600,user:{id:user,aud:'authenticated',email:'fixture@example.test',user_metadata:{},app_metadata:{},created_at:new Date().toISOString()}};
 await page.route('http://127.0.0.1:54321/auth/v1/**',r=>r.fulfill({status:200,headers:{'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'*'},json:session}));
 await page.route('**/api/me',r=>r.fulfill({json:{user:{id:user,display_name:'Fixture'},memberships:[{company_id:company,name:'Test A'},{company_id:other,name:'Test B'}]}}));
 await page.route('**/api/companies/*/access',r=>r.fulfill({json:{permissions:[{code:'inventory.read'},{code:'masterdata.read'},...(transfer?[{code:'inventory.transfer'}]:[])]}}));
 const row={id:'50000000-0000-4000-8000-000000000001',code:'CODE',name:'Fixture',active:true,kind:'company',notes:'',version:1};const bodies:any[]=[];
 await page.route(/\/api\/companies\/[^/]+\/(items|locations)/,r=>r.fulfill({json:r.request().url().includes(row.id)?{...row,path:[row],unit_id:row.id,supplier_id:row.id,standard_location_id:row.id}:{items:[row],total:1}}));
 await page.route(/\/api\/companies\/[^/]+\/inventory/,async r=>{
  const url=new URL(r.request().url());if(r.request().method()==='POST'){bodies.push(r.request().postDataJSON());if(bodies.length===1)return r.fulfill({status:503,json:{message:'Unavailable'}});return r.fulfill({status:201,json:{id:'entry'}});}
  if(url.pathname.endsWith('/history'))return r.fulfill({json:[]});
  const items=url.pathname.endsWith('/owners')?[row]:url.pathname.includes(other)?[]:url.pathname.endsWith('/balances')?[{item_id:row.id,owner_id:row.id,location_id:'60000000-0000-4000-8000-000000000001',quantity:'12.00000000',snapshot:{item:{code:'MAT',name:'Material'},owner:{name:'Company stock'},location:{name:'Shelf'},unit:{symbol:'kg'}}}]:[];
  return r.fulfill({json:{items,total:items.length}});
 });
 await page.route(/\/api\/companies\/[^/]+\/masterdata/,r=>r.fulfill({json:r.request().url().includes('/units/')?{...row,symbol:'kg',dimension:'mass'}:{items:[row],total:1}}));
 await page.route(/\/api\/companies\/[^/]+\/transfers/,async r=>{
  if(r.request().method()==='POST'){bodies.push(r.request().postDataJSON());return r.fulfill({status:bodies.length===1?503:201,json:bodies.length===1?{message:'Unavailable'}:{id:'transfer'}});}
  return r.fulfill({json:{items:[],total:0}});
 });
 await page.addInitScript(s=>sessionStorage.setItem('lager-auth-session',JSON.stringify(s)),session);
 await page.goto('/');await page.getByRole('button',{name:'Lagerflytning',exact:true}).click();return{row,bodies};
}
test('reader can list transfers but cannot create one',async({page})=>{
 await fixture(page,false);await expect(page.getByText('Ingen lagerflytninger fundet.')).toBeVisible();await expect(page.getByRole('button',{name:'Ny lagerflytning'})).toHaveCount(0);
 await page.getByLabel('Virksomhed',{exact:true}).selectOption(other);await page.getByRole('button',{name:'Lagerflytning',exact:true}).click();await expect(page.getByText('Ingen lagerflytninger fundet.')).toBeVisible();
});
test('moves a selected owner/location balance and retries identical request after uncertain response',async({page})=>{
 const {row,bodies}=await fixture(page);await page.getByRole('button',{name:'Ny lagerflytning',exact:true}).click();
 await page.getByLabel('Fra beholdning',{exact:true}).selectOption({index:1});await expect(page.getByText('Fysisk lager ved opslag:',{exact:false})).toBeVisible();await page.getByLabel('Tilplacering',{exact:true}).selectOption(row.id);await page.getByLabel('Mængde',{exact:true}).fill('1,00825001');
 let confirmations=0;page.on('dialog',d=>{expect(d.message()).toContain('samlet lager ændres ikke');confirmations++;void d.accept();});await page.getByRole('button',{name:'Bekræft lagerflytning'}).click();
 await expect(page.getByRole('alert')).toBeVisible();await expect(page.getByLabel('Mængde',{exact:true})).toBeDisabled();await page.getByRole('button',{name:'Prøv samme flytning igen'}).click();await expect(page.getByText('Lagerflytningen er bogført.')).toBeVisible();
 expect(bodies).toHaveLength(2);expect(bodies[0]).toEqual(bodies[1]);expect(bodies[0].quantity).toBe('1.00825001');expect(bodies[0].owner_id).toBe(row.id);expect(bodies[0].from_location_id).not.toBe(bodies[0].to_location_id);expect(confirmations).toBe(1);
});
