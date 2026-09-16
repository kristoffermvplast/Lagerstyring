import {test,expect,Page} from '@playwright/test';
const company='10000000-0000-4000-8000-000000000001',other='10000000-0000-4000-8000-000000000002',id='50000000-0000-4000-8000-000000000001';
async function fixture(page:Page,exporting=false){
 const user='20000000-0000-4000-8000-000000000001',payload=Buffer.from(JSON.stringify({sub:user,exp:Math.floor(Date.now()/1000)+3600,role:'authenticated'})).toString('base64url');
 const session={access_token:`e30.${payload}.fixture`,refresh_token:'local-refresh',token_type:'bearer',expires_in:3600,expires_at:Math.floor(Date.now()/1000)+3600,user:{id:user,aud:'authenticated',email:'fixture@example.test',user_metadata:{},app_metadata:{},created_at:new Date().toISOString()}};
 const permissions=['reports.read','inventory.read',...(exporting?['reports.export']:[])];
 await page.route('http://127.0.0.1:54321/auth/v1/**',r=>r.fulfill({json:session}));
 await page.route('**/api/me',r=>r.fulfill({json:{user:{id:user},memberships:[{company_id:company,name:'Test A'},{company_id:other,name:'Test B'}]}}));
 await page.route('**/api/companies/*/access',r=>r.fulfill({json:{permissions:permissions.map(code=>({code}))}}));
 const reads:URL[]=[],writes:any[]=[];let fail=false;
 await page.route(/\/api\/companies\/[^/]+\/reports\//,r=>{
  const u=new URL(r.request().url()),c=u.pathname.includes(other)?other:company,kind=u.pathname.split('/')[5];
  if(r.request().method()==='POST'){writes.push(r.request().postDataJSON());return r.fulfill({json:{company_id:c,filename:'report.csv',csv:'\uFEFF"quantity"\r\n"12.00000001"',sha256:'a'.repeat(64),row_count:26,as_of:'2026-09-16T12:00:00Z',receipt:{id}}});}
  if(kind==='exports')return r.fulfill({json:{company_id:c,items:[]}});
  reads.push(u);if(fail)return r.fulfill({status:503,json:{message:'Unavailable'}});
  const row={row_id:id,occurred_at:'2026-09-16T12:00:00Z',source_id:id,entry_id:id,order_id:null,item_id:id,owner_id:id,location_id:id,unit_id:id,code:'REPORT',name:u.searchParams.get('page')==='2'?'Second page':'First page',owner:'Owner',location:'Store',unit:'kg',reference:'REF',kind:'correction',quantity:'12.00000001',reserved_quantity:'2.00000000',available_quantity:'10.00000001',reverses_id:null};
  return r.fulfill({json:{company_id:c,report:kind,as_of:row.occurred_at,total:c===other?0:26,items:c===other?[]:[row],totals:c===other?[]:[{unit_id:id,unit:'kg',quantity:'30.00000001',reserved_quantity:'2.00000000',available_quantity:'28.00000001'}]}});
 });
 await page.route(/\/api\/companies\/[^/]+\/inventory\//,r=>r.fulfill({json:r.request().url().includes('/entries/'+id)?{id,reason:'Exact report journal',posted_at:'2026-09-16T12:00:00Z',kind:'correction',lines:[]}:{items:[],total:0}}));
 await page.addInitScript(s=>sessionStorage.setItem('lager-auth-session',JSON.stringify(s)),session);await page.goto('/');await page.getByRole('button',{name:'Rapporter',exact:true}).click();await expect(page.getByText('REPORT · First page')).toBeVisible();
 return{reads,writes,fail:()=>{fail=true;}};
}
test('source permissions constrain reports; applied filters and pages retain full totals',async({page})=>{
 const f=await fixture(page);await expect(page.getByRole('button',{name:'Eksportér filtreret CSV'})).toHaveCount(0);await expect(page.getByLabel('Rapporttype').locator('option')).toHaveCount(2);
 await page.getByRole('button',{name:'Næste rapportside'}).click();await expect(page.getByText('REPORT · Second page')).toBeVisible();await expect(page.getByText('30.00000001 kg',{exact:false})).toBeVisible();
 await page.getByLabel('Søg varenummer, navn eller reference').fill('NEW');expect(f.reads.at(-1)?.searchParams.has('q')).toBe(false);await page.getByRole('button',{name:'Anvend rapportfiltre'}).click();await expect(page.getByText('REPORT · First page')).toBeVisible();expect(f.reads.at(-1)?.searchParams.get('q')).toBe('NEW');expect(f.reads.at(-1)?.searchParams.get('page')).toBe('1');
});
test('stock links to exact journal filters and source entry; changing company clears report data',async({page})=>{
 const f=await fixture(page);await page.getByRole('button',{name:'Se lagerjournal'}).click();await expect(page.getByLabel('Rapporttype')).toHaveValue('inventory');await expect(page.getByRole('button',{name:'Åbn journalpost'})).toBeVisible();for(const k of ['item_id','owner_id','location_id'])expect(f.reads.at(-1)?.searchParams.get(k)).toBe(id);
 await page.getByRole('button',{name:'Åbn journalpost'}).click();await expect(page.getByRole('heading',{name:'Exact report journal'})).toBeVisible();
 await page.getByLabel('Virksomhed',{exact:true}).selectOption(other);await page.getByRole('button',{name:'Rapporter',exact:true}).click();await expect(page.getByText('Ingen rækker matcher filtrene.')).toBeVisible();await expect(page.getByText('REPORT · First page')).toHaveCount(0);expect(f.reads.at(-1)?.searchParams.has('item_id')).toBe(false);
});
test('CSV exports applied filters instead of unsaved input or current page and shows generation receipt',async({page})=>{
 const f=await fixture(page,true);await page.getByLabel('Søg varenummer, navn eller reference').fill('SAVED');await page.getByRole('button',{name:'Anvend rapportfiltre'}).click();await expect.poll(()=>f.reads.at(-1)?.searchParams.get('q')).toBe('SAVED');await page.getByRole('button',{name:'Næste rapportside'}).click();await expect(page.getByText('REPORT · Second page')).toBeVisible();await page.getByLabel('Søg varenummer, navn eller reference').fill('UNSAVED');
 const download=page.waitForEvent('download');await page.getByRole('button',{name:'Eksportér filtreret CSV'}).click();expect((await download).suggestedFilename()).toBe('report.csv');await expect(page.getByRole('status')).toContainText('26 rækker genereret');expect(f.writes).toEqual([{q:'SAVED'}]);
});
test('failed refresh hides stale export and source actions',async({page})=>{
 const f=await fixture(page,true);f.fail();await page.getByRole('button',{name:'Opdatér rapport'}).click();await expect(page.getByRole('alert')).toBeVisible();await expect(page.getByRole('button',{name:'Eksportér filtreret CSV'})).toHaveCount(0);await expect(page.getByRole('button',{name:'Se lagerjournal'})).toHaveCount(0);expect(f.writes).toEqual([]);
});
