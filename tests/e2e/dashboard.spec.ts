import {test,expect,Page} from '@playwright/test';
const company='10000000-0000-4000-8000-000000000001',other='10000000-0000-4000-8000-000000000002',id='50000000-0000-4000-8000-000000000001';
async function fixture(page:Page,write=true,limited=false){
 const user='20000000-0000-4000-8000-000000000001',payload=Buffer.from(JSON.stringify({sub:user,exp:Math.floor(Date.now()/1000)+3600,role:'authenticated'})).toString('base64url');
 const session={access_token:`e30.${payload}.fixture`,refresh_token:'local-refresh',token_type:'bearer',expires_in:3600,expires_at:Math.floor(Date.now()/1000)+3600,user:{id:user,aud:'authenticated',email:'fixture@example.test',user_metadata:{},app_metadata:{},created_at:new Date().toISOString()}};
 const permissions=['dashboard.read','inventory.read','masterdata.read','counts.read',...(write?['dashboard.acknowledge']:[])];
 await page.route('http://127.0.0.1:54321/auth/v1/**',r=>r.fulfill({status:200,json:session}));
 await page.route('**/api/me',r=>r.fulfill({json:{user:{id:user},memberships:[{company_id:company,name:'Test A'},{company_id:other,name:'Test B'}]}}));
 await page.route('**/api/companies/*/access',r=>r.fulfill({json:{permissions:permissions.map(code=>({code}))}}));
 const bodies:any[]=[];let acknowledged=false,fail=false;
 await page.route(/\/api\/companies\/[^/]+\/dashboard/,r=>{
  if(r.request().method()==='POST'){bodies.push(r.request().postDataJSON());if(bodies.length===1)return r.fulfill({status:503,json:{message:'Unavailable'}});acknowledged=true;return r.fulfill({status:201,json:{state:'acknowledged'}});}
  if(fail)return r.fulfill({status:503,json:{message:'Unavailable'}});
  const c=r.request().url().includes(other)?other:company;
  return r.fulfill({json:{company_id:c,as_of:'2026-09-15T12:00:00Z',day:'2026-09-15',permissions,limited:limited?['Lager']:[],orders:[],shipments:[],receipts:[],alerts:c===other?[]:[{key:'count-stale:'+id,fingerprint:'a'.repeat(64),severity:'critical',state:acknowledged?'acknowledged':'open',title:'Optælling kræver gentælling',detail:'Lageret har flyttet sig.',target:{page:'Optælling',id}},{key:'stock-low:'+id,fingerprint:'b'.repeat(64),severity:'attention',state:'open',title:'Materiale under grænse',detail:'Kontrollér ejerskab.',target:{page:'Lager',q:'DASH'}}]}});
 });
 await page.route(/\/api\/companies\/[^/]+\/stock-counts/,r=>r.fulfill({json:r.request().url().endsWith('/'+id)?{id,status:'cancelled',snapshot:{item:{code:'DASH',name:'Materiale'},owner:{name:'Ejer'},location:{name:'Lager'},unit:{symbol:'kg'}},baseline_quantity:'10',counted_quantity:'9',current_quantity:'11',events:[],reservations:[]}:{items:[],total:0}}));
 await page.route(/\/api\/companies\/[^/]+\/inventory\/balances/,r=>r.fulfill({json:{items:[],total:0}}));
 await page.addInitScript(s=>sessionStorage.setItem('lager-auth-session',JSON.stringify(s)),session);await page.goto('/');await expect(page.getByRole('heading',{name:'Kritiske advarsler · 1'})).toBeVisible();return{bodies,fail:()=>{fail=true;}};
}
test('read-only dashboard leads to exact count and filters stock; company switch clears prior data',async({page})=>{
 await fixture(page,false);await expect(page.getByRole('button',{name:'Kvittér som set'})).toHaveCount(0);
 await page.getByRole('button',{name:'Åbn optælling',exact:true}).click();await expect(page.getByRole('heading',{name:'Optælling · Annulleret'})).toBeVisible();
 await page.getByRole('button',{name:'Overblik',exact:true}).click();await page.getByRole('button',{name:'Åbn lager',exact:true}).click();await expect(page.getByRole('searchbox')).toHaveValue('DASH');
 await page.getByLabel('Virksomhed',{exact:true}).selectOption(other);await expect(page.getByRole('heading',{name:'Kritiske advarsler · 0'})).toBeVisible();await expect(page.getByText('Optælling kræver gentælling')).toHaveCount(0);
});
test('uncertain acknowledgement retries identical version and moves alert to acknowledged',async({page})=>{
 const {bodies}=await fixture(page);const article=page.getByRole('article').filter({has:page.getByRole('heading',{name:'Optælling kræver gentælling'})});await article.getByRole('button',{name:'Kvittér som set'}).click();await expect(article.getByRole('alert')).toBeVisible();await article.getByRole('button',{name:'Kvittér som set'}).click();await expect(page.getByRole('heading',{name:'Kvitteret af dig · 1'})).toBeVisible();expect(bodies).toHaveLength(2);expect(bodies[0]).toEqual(bodies[1]);
});
test('partial or failed overview never presents cached actions as current',async({page})=>{
 const f=await fixture(page,false,true);await expect(page.getByRole('alert')).toContainText('Delvist overblik');f.fail();await page.getByRole('button',{name:'Opdatér dashboard'}).click();await expect(page.getByRole('alert')).toContainText('Genindlæs før du handler');await expect(page.getByRole('button',{name:'Åbn optælling'})).toHaveCount(0);
});
