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
 await page.route(/\/api\/companies\/[^/]+\/locations/,async r=>{
  const url=new URL(r.request().url()),parts=url.pathname.split('/'),tenant=parts[3],id=parts[5],key=tenant+'locations';rows[key]??=[];
  const path=(row:any):any[]=>row?[...(row.parent_id?path(rows[key].find(x=>x.id===row.parent_id)):[]),row]:[];
  if(parts[6]==='history')return r.fulfill({json:histories[id]??[]});
  if(r.request().method()==='GET'){
   if(id){const row=rows[key].find(x=>x.id===id);return r.fulfill({json:{...row,path:path(row)}});}
   const q=url.searchParams.get('q')??'',parent=url.searchParams.get('parent_id')??'all',exclude=url.searchParams.get('exclude_subtree');
   const items=rows[key].filter(x=>(x.code+' '+x.name).includes(q)&&(parent==='all'||(parent==='root'?!x.parent_id:x.parent_id===parent))&&(!exclude||!path(x).some(c=>c.id===exclude))).map(x=>({...x,child_count:rows[key].filter(c=>c.parent_id===x.id).length}));
   return r.fulfill({json:{items,total:items.length,page:1,limit:25}});
  }
  const input=r.request().postDataJSON(),old=id?rows[key].find(x=>x.id===id):null;
  const next={...(input.data??input),company_id:tenant,id:id??`60000000-0000-4000-8000-${String(++seq).padStart(12,'0')}`,version:(old?.version??0)+1};
  rows[key]=[...rows[key].filter(x=>x.id!==id),next];histories[next.id]=[{id:next.id+next.version,actor_id:user,occurred_at:new Date().toISOString(),before_value:old,after_value:next},...(histories[next.id]??[])];
  return r.fulfill({status:old?200:201,json:next});
 });
 await page.goto('/');await expect(page.getByRole('heading',{name:'Velkommen tilbage'})).toBeVisible();await page.evaluate(s=>sessionStorage.setItem('lager-auth-session',JSON.stringify(s)),session);await page.reload();await expect(page.getByRole('heading',{name:'Overblik',exact:true})).toBeVisible();return rows;
}
test('creates hierarchy, navigates breadcrumbs, edits with history and switches company',async({page})=>{
 await fixture(page);await page.getByRole('button',{name:'Lagerplaceringer',exact:true}).click();
 await page.getByRole('button',{name:'Opret placering',exact:true}).click();await page.getByLabel('Placeringskode',{exact:true}).fill('ROOT');await page.getByLabel('Placeringsnavn',{exact:true}).fill('Root fixture');await page.getByRole('button',{name:'Gem placering',exact:true}).click();
 await page.getByRole('button',{name:'Underplaceringer (0)',exact:true}).click();await expect(page.getByRole('navigation',{name:'Placeringssti'})).toContainText('ROOT');
 await page.getByRole('button',{name:'Opret placering',exact:true}).click();await expect(page.getByLabel('Overordnet placering',{exact:true})).not.toHaveValue('');await page.getByLabel('Placeringskode',{exact:true}).fill('CHILD');await page.getByLabel('Placeringsnavn',{exact:true}).fill('Child fixture');await page.getByRole('button',{name:'Gem placering',exact:true}).click();
 await expect(page.getByRole('cell',{name:'Child fixture',exact:true})).toBeVisible();await page.getByRole('button',{name:'Redigér',exact:true}).click();await expect(page.getByLabel('Overordnet placering',{exact:true}).locator('option').filter({hasText:'CHILD'})).toHaveCount(0);await page.getByLabel('Placeringsnavn',{exact:true}).fill('Changed child');await page.getByRole('button',{name:'Gem placering',exact:true}).click();
 await page.getByRole('button',{name:'Detaljer og historik',exact:true}).click();await expect(page.getByRole('heading',{name:'Changed child'})).toBeVisible();await expect(page.locator('details summary')).toHaveCount(2);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(page.viewportSize()!.width);
 await page.getByLabel('Virksomhed',{exact:true}).selectOption(other);await page.getByRole('button',{name:'Lagerplaceringer',exact:true}).click();await expect(page.getByRole('cell',{name:'Changed child'})).toHaveCount(0);
});
test('inline location creation preserves product draft and selects the new location',async({page})=>{
 const rows=await fixture(page);await page.getByRole('button',{name:'Varer',exact:true}).click();await page.getByRole('button',{name:'Opret ny'}).click();await page.getByLabel('Nummer',{exact:true}).fill('P');await page.getByLabel('Navn',{exact:true}).fill('Product draft');
 await page.getByRole('button',{name:'Opret standardlagerplacering',exact:true}).click();const dialog=page.getByRole('dialog',{name:'Opret placering',exact:true});await dialog.getByLabel('Placeringskode',{exact:true}).fill('S');await dialog.getByLabel('Placeringsnavn',{exact:true}).fill('Storage');await dialog.getByRole('button',{name:'Gem placering'}).click();
 await expect(dialog).toHaveCount(0);await expect(page.getByLabel('Navn',{exact:true})).toHaveValue('Product draft');expect(rows[company+'product']).toHaveLength(0);await expect(page.getByLabel('Standardlagerplacering',{exact:true})).not.toHaveValue('');await page.getByRole('button',{name:'Gem',exact:true}).click();expect(rows[company+'product'][0].standard_location_id).toBe(rows[company+'locations'][0].id);
});
test('reader can navigate but cannot create locations',async({page})=>{
 await fixture(page,false);await page.getByRole('button',{name:'Lagerplaceringer',exact:true}).click();await expect(page.getByRole('button',{name:'Opret placering',exact:true})).toHaveCount(0);await expect(page.getByRole('button',{name:'Vis alle placeringer'})).toBeVisible();
});
