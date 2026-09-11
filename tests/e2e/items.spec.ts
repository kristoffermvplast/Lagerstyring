import { test, expect, Page } from '@playwright/test';
const company='10000000-0000-4000-8000-000000000001', other='10000000-0000-4000-8000-000000000002';
async function fixture(page:Page,manage=true) {
 const user='20000000-0000-4000-8000-000000000001';
 const payload=Buffer.from(JSON.stringify({sub:user,exp:Math.floor(Date.now()/1000)+3600,role:'authenticated'})).toString('base64url');
 const session={access_token:`e30.${payload}.fixture`,refresh_token:'local-refresh',token_type:'bearer',expires_in:3600,expires_at:Math.floor(Date.now()/1000)+3600,user:{id:user,aud:'authenticated',email:'fixture@example.test',user_metadata:{},app_metadata:{},created_at:new Date().toISOString()}};
 const rows:Record<string,any[]>={}, histories:Record<string,any[]>={};let seq=0;
 await page.route('http://127.0.0.1:54321/auth/v1/**',r=>r.fulfill({status:200,headers:{'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'*'},json:session}));
 await page.route('**/api/me',r=>r.fulfill({json:{user:{id:user,display_name:'Fixture',email:'fixture@example.test'},memberships:[{company_id:company,name:'Test A',role_id:'a'},{company_id:other,name:'Test B',role_id:'b'}]}}));
 await page.route('**/api/companies/*/access',r=>r.fulfill({json:{permissions:[{code:'masterdata.read'},...(manage?[{code:'masterdata.manage'}]:[])]}}));
 await page.route(/\/api\/companies\/[^/]+\/(items|masterdata)\//,async r=>{
  const url=new URL(r.request().url()),parts=url.pathname.split('/'),tenant=parts[3],kind=parts[5],id=parts[6],key=tenant+kind;rows[key]??=[];
  if(parts[7]==='photo')return r.fulfill({json:{enabled:false,photo:null}});
  if(parts[7]==='history')return r.fulfill({json:histories[id]??[]});
  if(r.request().method()==='GET') {
   if(id)return r.fulfill({json:rows[key].find(x=>x.id===id)});
   const q=url.searchParams.get('q')??'',active=url.searchParams.get('active');
   const items=rows[key].filter(x=>(x.code+' '+x.name).includes(q)&&(active==='all'||!active||String(x.active)===active));
   return r.fulfill({json:{items,total:items.length,page:1,limit:25}});
  }
  const input=r.request().postDataJSON(),old=id?rows[key].find(x=>x.id===id):null;
  const next={...(input.data??input),kind,company_id:tenant,id:id??`50000000-0000-4000-8000-${String(++seq).padStart(12,'0')}`,version:(old?.version??0)+1};
  rows[key]=[...rows[key].filter(x=>x.id!==id),next];histories[next.id]=[{id:next.id+next.version,actor_id:user,occurred_at:new Date().toISOString(),before_value:old,after_value:next},...(histories[next.id]??[])];
  return r.fulfill({status:old?200:201,json:next});
 });
 await page.goto('/');await expect(page.getByRole('heading',{name:'Velkommen tilbage'})).toBeVisible();await page.evaluate(s=>sessionStorage.setItem('lager-auth-session',JSON.stringify(s)),session);await page.reload();await expect(page.getByRole('heading',{name:'Overblik',exact:true})).toBeVisible();return rows;
}
test('minimal product create edit deactivate and history on every viewport',async({page})=>{
 await fixture(page);await page.getByRole('button',{name:'Varer',exact:true}).click();await page.getByRole('button',{name:'Opret ny'}).click();
 await page.getByLabel('Nummer',{exact:true}).fill('ITEM-1');await page.getByLabel('Navn',{exact:true}).fill('Product fixture');
 await expect(page.getByLabel('Minimumslager',{exact:true})).toBeDisabled();await page.getByRole('button',{name:'Gem',exact:true}).click();
 await expect(page.getByRole('cell',{name:'Product fixture',exact:true})).toBeVisible();await expect(page.getByText('Lagerenhed mangler',{exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Redigér',exact:true}).click();await page.getByLabel('Navn',{exact:true}).fill('Changed fixture');await page.getByLabel('Aktiv',{exact:true}).uncheck();page.once('dialog',d=>d.accept());await page.getByRole('button',{name:'Gem',exact:true}).click();
 await expect(page.getByText('Inaktiv',{exact:true})).toBeVisible();await page.getByRole('button',{name:'Detaljer og historik'}).click();await expect(page.getByRole('heading',{name:'Changed fixture'})).toBeVisible();await expect(page.locator('details summary').filter({hasText:/Oprettet|Ændret/})).toHaveCount(2);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(page.viewportSize()!.width);
});
test('inline unit keeps material draft and decimal input stays exact',async({page})=>{
 const rows=await fixture(page);await page.getByRole('button',{name:'Materialer',exact:true}).click();await page.getByRole('button',{name:'Opret ny'}).click();
 await page.getByLabel('Nummer',{exact:true}).fill('MAT-1');await page.getByLabel('Navn',{exact:true}).fill('Material fixture');await page.getByRole('button',{name:'Opret lagerenhed',exact:true}).click();
 await page.getByLabel('Nummer / kode',{exact:true}).fill('MASS');await page.getByLabel('Navn',{exact:true}).last().fill('Mass');await page.getByLabel('Symbol',{exact:true}).fill('m');await page.getByLabel('Enhedstype',{exact:true}).selectOption('mass');await page.getByRole('button',{name:'Gem',exact:true}).last().click();
 await expect(page.getByLabel('Navn',{exact:true})).toHaveCount(1);await expect(page.getByLabel('Nummer',{exact:true})).toHaveValue('MAT-1');await expect(page.getByLabel('Lagerenhed',{exact:true})).not.toHaveValue('');await page.getByLabel('Minimumslager',{exact:true}).fill('0,00825001');await page.getByRole('button',{name:'Gem',exact:true}).click();await expect(page.getByRole('cell',{name:'Material fixture',exact:true})).toBeVisible();expect(rows[company+'material'][0].minimum_stock).toBe('0.00825001');
});
test('packaging is separate and company switch discards previous data and drafts',async({page})=>{
 await fixture(page);await page.getByRole('button',{name:'Emballage',exact:true}).click();await page.getByRole('button',{name:'Opret ny'}).click();await page.getByLabel('Nummer',{exact:true}).fill('PACK');await page.getByLabel('Navn',{exact:true}).fill('Packaging A');await page.getByRole('button',{name:'Gem',exact:true}).click();await expect(page.getByRole('cell',{name:'Packaging A'})).toBeVisible();
 await page.getByLabel('Virksomhed',{exact:true}).selectOption(other);await page.getByRole('button',{name:'Emballage',exact:true}).click();await expect(page.getByRole('cell',{name:'Packaging A'})).toHaveCount(0);await expect(page.getByText(/Ingen resultater/)).toBeVisible();
});
test('read-only user cannot open create forms',async({page})=>{
 await fixture(page,false);for(const name of ['Varer','Materialer','Emballage']) {await page.getByRole('button',{name,exact:true}).click();await expect(page.getByRole('button',{name:'Opret ny'})).toHaveCount(0);await expect(page.getByText(/Ingen resultater/)).toBeVisible();}
});
test('authorized photo upload displays the raster through the backend',async({page})=>{
 const rows=await fixture(page);let photo:any=null;
 await page.route('**/api/companies/*/items/*/*/photo',async r=>{
  if(r.request().method()==='POST'){const input=r.request().postDataJSON();photo={mime:input.mime,base64:input.base64};rows[company+'product'][0].version++;return r.fulfill({status:201,json:{version:2}});}
  return r.fulfill({json:{enabled:true,photo}});
 });
 await page.getByRole('button',{name:'Varer',exact:true}).click();await page.getByRole('button',{name:'Opret ny'}).click();await page.getByLabel('Nummer',{exact:true}).fill('PHOTO');await page.getByLabel('Navn',{exact:true}).fill('Photo fixture');await page.getByRole('button',{name:'Gem',exact:true}).click();await page.getByRole('button',{name:'Detaljer og historik'}).click();
 await page.locator('input[type=file]').setInputFiles({name:'fixture.png',mimeType:'image/png',buffer:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a1XcAAAAASUVORK5CYII=','base64')});
 await expect(page.getByRole('img',{name:'Foto af Photo fixture'})).toBeVisible();expect(photo.mime).toBe('image/png');
});
