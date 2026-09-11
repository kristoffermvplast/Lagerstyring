import { test, expect, Page } from '@playwright/test';
const company='10000000-0000-4000-8000-000000000001', other='10000000-0000-4000-8000-000000000002';
async function baseFixture(page:Page,manage=true) {
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
async function recipeFixture(page:Page,manage=true){
 const rows=await baseFixture(page,manage),product='50000000-0000-4000-8000-000000000001',component='50000000-0000-4000-8000-000000000002',box='50000000-0000-4000-8000-000000000003',pallet='50000000-0000-4000-8000-000000000004';
 rows[company+'product']=[{id:product,code:'P',name:'Product',active:true}];rows[company+'material']=[{id:component,code:'M',name:'Material',active:true}];rows[company+'packaging']=[{id:box,code:'BOX',name:'Box',active:true},{id:pallet,code:'PAL',name:'Pallet',active:true}];
 const recipes:any[]=[],requests:any[]=[];
 await page.route(/\/api\/companies\/[^/]+\/recipes/,async route=>{
  const req=route.request(),url=new URL(req.url()),parts=url.pathname.split('/'),tenant=parts[3],id=parts[5],sub=parts[6];
  if(tenant!==company)return route.fulfill({json:[]});
  if(id==='calculate'){requests.push(req.postDataJSON());return route.fulfill({status:201,json:{quantity:'1009',materials:[],packaging:[{component_id:box,snapshot:{name:'Box',unit:'stk.'},quantity:'85'},{component_id:pallet,snapshot:{name:'Pallet',unit:'stk.'},quantity:'3'}],containers:[{level:1,full:'2',partial:'1',capacity:'504',remainder:'1'}]}});}
  const record=recipes.find(r=>r.id===id);
  if(req.method()==='GET'){
   if(sub==='history')return route.fulfill({json:[]});
   if(sub==='revisions')return route.fulfill({json:record.revisions.find((v:any)=>v.id===parts[7])});
   return route.fulfill({json:id?record:recipes});
  }
  const body=req.postDataJSON();requests.push(body);
  if(!id){const item={...body,id:`60000000-0000-4000-8000-${String(recipes.length+1).padStart(12,'0')}`,version:1,active:true,is_default:false,notes:'',current_revision_id:null,revisions:[]};recipes.push(item);return route.fulfill({status:201,json:item});}
  if(sub==='revisions'){
   const rev={...body.data,id:`70000000-0000-4000-8000-${String(record.revisions.length+1).padStart(12,'0')}`,revision:record.revisions.length+1,snapshot:{name:'Product snapshot',unit:'stk.'},lines:body.data.lines.map((l:any)=>({...l,snapshot:{name:l.component_id===box?'Box':l.component_id===pallet?'Pallet':'Material',unit:'stk.'}}))};record.current=rev;record.current_revision_id=rev.id;record.revisions.unshift(rev);record.version++;return route.fulfill({status:201,json:rev});
  }
  Object.assign(record,body.data,{version:record.version+1});return route.fulfill({json:record});
 });
 await page.getByRole('button',{name:'Styklister og pakning',exact:true}).click();await page.getByLabel('Vare',{exact:true}).selectOption(product);
 return{requests,recipes,component,box,pallet};
}
test('creates immutable BOM versions using decimal strings and preserves previous snapshot',async({page})=>{
 const f=await recipeFixture(page);await page.getByLabel('Navn',{exact:true}).fill('Production recipe');await page.getByRole('button',{name:'Opret opsætning'}).click();await page.getByRole('button',{name:'Ny version',exact:true}).click();
 await page.getByLabel('Basis i varens lagerenhed').fill('12');await page.getByRole('button',{name:'Tilføj linje'}).click();await page.getByLabel('Komponent 1',{exact:true}).selectOption(f.component);await page.getByLabel('Forbrug pr. basis').fill('0,00825');page.once('dialog',d=>d.accept());await page.getByRole('button',{name:'Gem ny version'}).click();await expect(page.getByText(/Version 1 · Product snapshot/)).toBeVisible();
 expect(f.requests.find(x=>x.data?.lines).data.lines[0].quantity).toBe('0.00825');
 await page.getByRole('button',{name:'Ny version',exact:true}).click();await page.getByLabel('Forbrug pr. basis').fill('2');page.once('dialog',d=>d.accept());await page.getByRole('button',{name:'Gem ny version'}).click();await expect(page.getByText(/Version 2 · Product snapshot/)).toBeVisible();await page.getByLabel('Vis version').selectOption(f.recipes[0].revisions[1].id);await expect(page.getByText(/Version 1 · Product snapshot/)).toBeVisible();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(page.viewportSize()!.width);
});
test('builds nested packing and previews full and partial pallets without inventory actions',async({page})=>{
 const f=await recipeFixture(page);await page.getByLabel('Type',{exact:true}).selectOption('packing');await page.getByLabel('Navn',{exact:true}).fill('Standard packing');await page.getByRole('button',{name:'Opret opsætning'}).click();await page.getByRole('button',{name:'Ny version',exact:true}).click();
 await page.getByRole('button',{name:'Tilføj linje'}).click();await page.getByLabel('Komponent 1',{exact:true}).selectOption(f.box);await page.getByLabel('Kapacitet',{exact:true}).fill('12');await page.getByRole('button',{name:'Tilføj linje'}).click();await page.getByLabel('Komponent 2',{exact:true}).selectOption(f.pallet);await page.getByLabel('Kapacitet',{exact:true}).nth(1).fill('42');page.once('dialog',d=>d.accept());await page.getByRole('button',{name:'Gem ny version'}).click();await expect(page.getByText(/Version 1 · Product snapshot/)).toBeVisible();
 await page.getByRole('button',{name:'Gør til standard'}).click();await expect(page.getByRole('cell',{name:'Standard packing · Standard'})).toBeVisible();await page.getByLabel('Produktionsmængde',{exact:true}).fill('1009');await page.getByRole('button',{name:'Beregn',exact:true}).click();await expect(page.getByText('Box: 85 stk. · Pakning')).toBeVisible();await expect(page.getByText(/2 fulde \+ 1 delbeholdere/)).toBeVisible();
 expect(f.requests.find(x=>x.data?.lines).data.lines.map((l:any)=>[l.level,l.quantity])).toEqual([[0,'12'],[1,'42']]);
});
test('read-only rights and company switch hide mutations and discard previous product',async({page})=>{
 await recipeFixture(page,false);await expect(page.getByRole('button',{name:'Opret opsætning'})).toHaveCount(0);await page.getByLabel('Virksomhed',{exact:true}).selectOption(other);await page.getByRole('button',{name:'Styklister og pakning',exact:true}).click();await expect(page.getByLabel('Vare',{exact:true})).toHaveValue('');await expect(page.getByRole('heading',{name:'Beregn behov'})).toHaveCount(0);
});
test('inline creation preserves the BOM draft and does not submit the parent form',async({page})=>{
 const f=await recipeFixture(page);await page.getByLabel('Navn',{exact:true}).fill('Inline recipe');await page.getByRole('button',{name:'Opret opsætning'}).click();await page.getByRole('button',{name:'Ny version',exact:true}).click();await page.getByLabel('Basis i varens lagerenhed').fill('12');await page.getByRole('button',{name:'Tilføj linje'}).click();await page.getByRole('button',{name:'Opret komponent 1'}).click();const dialog=page.getByRole('dialog',{name:'Opret stamdata'});await expect(dialog).toBeVisible();await dialog.getByLabel('Nummer',{exact:true}).fill('NEW');await dialog.getByLabel('Navn',{exact:true}).fill('New component');await dialog.getByRole('button',{name:'Gem',exact:true}).click();await expect(dialog).toHaveCount(0);await expect(page.getByLabel('Basis i varens lagerenhed')).toHaveValue('12');await expect(page.getByLabel('Komponent 1',{exact:true})).not.toHaveValue('');expect(f.requests.filter(x=>x.data?.lines)).toHaveLength(0);
});
