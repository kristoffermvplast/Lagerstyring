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
test('touch navigation stays bounded and keyboard focus follows page and company changes',async({page})=>{
 await fixture(page);await expect(page.locator('#content')).toBeFocused();
 if((page.viewportSize()?.width??2000)<=1000){
  const nav=await page.locator('#workspace-menu').boundingBox();expect(nav!.height).toBeLessThanOrEqual(page.viewportSize()!.height*.35+1);
  await page.getByRole('button',{name:'Gå til menu',exact:true}).click();await expect(page.locator('#workspace-menu')).toBeFocused();
 }
 await openWorkspace(page,'Lager');await expect(page.locator('#content')).toBeFocused();
 await page.getByLabel('Virksomhed',{exact:true}).selectOption(other);await expect(page.getByRole('heading',{name:'Overblik',exact:true})).toBeVisible();await expect(page.locator('#content')).toBeFocused();
});
test('narrow form supports decimal entry and no document overflow in portrait and landscape',async({page})=>{
 await fixture(page);await page.getByRole('button',{name:'Ny modtagelse'}).click();
 for(const viewport of [{width:320,height:640},{width:844,height:390}]){
  await page.setViewportSize(viewport);const input=page.getByLabel('Modtaget mængde');await input.fill('8,00000001');await expect(input).toHaveAttribute('inputmode','decimal');
  const metrics=await input.evaluate(el=>({height:el.getBoundingClientRect().height,font:parseFloat(getComputedStyle(el).fontSize)}));expect(metrics.height).toBeGreaterThanOrEqual(44);expect(metrics.font).toBeGreaterThanOrEqual(16);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
 }
});
test('lost receipt response keeps exact retry payload and reconnect never resends it automatically',async({page})=>{
 const {row}=await fixture(page);const requests:any[]=[],posted=new Set<string>();
 await page.route(/\/api\/companies\/[^/]+\/receipts/,async r=>{
  if(r.request().method()!=='POST')return r.fulfill({json:{items:[],total:0}});
  const body=r.request().postDataJSON();requests.push(body);posted.add(body.idempotency_key);
  if(requests.length===1)return r.abort('connectionreset');return r.fulfill({status:201,json:{id:'receipt'}});
 });
 await page.getByRole('button',{name:'Ny modtagelse'}).click();await chooseReference(page,'Vare',row.id);await chooseReference(page,'Ejer',row.id);await expect(page.getByText('Lagerenhed: kg')).toBeVisible();await expect(page.getByLabel('Placering',{exact:true})).toHaveValue(row.id);await page.getByLabel('Modtaget mængde').fill('8,00000001');page.on('dialog',d=>void d.accept());
 await page.getByRole('button',{name:'Bekræft modtagelse'}).click();await expect(page.getByRole('alert')).toContainText('Handlingen kan være gemt');await expect(page.getByLabel('Modtaget mængde')).toBeDisabled();expect(requests).toHaveLength(1);
 await page.evaluate(()=>window.dispatchEvent(new Event('offline')));await expect(page.getByText('Enheden er offline.',{exact:false})).toBeVisible();await page.evaluate(()=>window.dispatchEvent(new Event('online')));await expect(page.getByText('Enheden melder netværk igen.',{exact:false})).toBeVisible();expect(requests).toHaveLength(1);
 await page.getByRole('button',{name:'Prøv samme modtagelse igen'}).click();await expect(page.getByText('Modtagelsen er bogført på lageret.')).toBeVisible();expect(requests).toHaveLength(2);expect(requests[0]).toEqual(requests[1]);expect(posted.size).toBe(1);
});
