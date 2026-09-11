import {test,expect,type Page} from '@playwright/test';
const user='20000000-0000-4000-8000-000000000001',company='10000000-0000-4000-8000-000000000001',other='10000000-0000-4000-8000-000000000002';
async function fixture(page:Page,write=true){
 const payload=Buffer.from(JSON.stringify({sub:user,exp:Math.floor(Date.now()/1000)+3600,role:'authenticated'})).toString('base64url');
 const session={access_token:`e30.${payload}.fixture`,refresh_token:'local-refresh',token_type:'bearer',expires_in:3600,expires_at:Math.floor(Date.now()/1000)+3600,user:{id:user,aud:'authenticated',email:'fixture@example.test',user_metadata:{},app_metadata:{},created_at:new Date().toISOString()}};
 const rows:Record<string,any[]>={};const histories:Record<string,any[]>={};let seq=0;
 await page.route('http://127.0.0.1:54321/auth/v1/**',r=>r.fulfill({status:200,headers:{'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'*'},json:session}));
 await page.route('**/api/me',r=>r.fulfill({json:{user:{id:user,display_name:'Fixture',email:'fixture@example.test'},memberships:[{company_id:company,name:'Test A',role_id:'a'},{company_id:other,name:'Test B',role_id:'b'}]}}));
 await page.route('**/api/companies/*/access',r=>r.fulfill({json:{permissions:[{code:'masterdata.read'},...(write?[{code:'masterdata.manage'}]:[])]}}));
 await page.route('**/api/companies/*/masterdata/**',async r=>{
  const url=new URL(r.request().url()),parts=url.pathname.split('/'),tenant=parts[3],kind=parts[5],id=parts[6],key=tenant+kind;rows[key]??=[];
  if(parts[7]==='history')return r.fulfill({json:histories[id]??[]});
  if(r.request().method()==='GET'){
   const q=url.searchParams.get('q')??'',active=url.searchParams.get('active');
   const items=rows[key].filter(x=>(x.code+' '+x.name).includes(q)&&(active==='all'||!active||String(x.active)===active));
   return r.fulfill({json:{items,total:items.length,page:1,limit:25}});
  }
  const input=r.request().postDataJSON();const old=id?rows[key].find(x=>x.id===id):null;
  const next={...(input.data??input),id:id??`50000000-0000-4000-8000-${String(++seq).padStart(12,'0')}`,version:(old?.version??0)+1};
  rows[key]=[...rows[key].filter(x=>x.id!==id),next];histories[next.id]=[{id:next.id+next.version,actor_id:user,action:old?'UPDATE':'INSERT',occurred_at:new Date().toISOString(),before_value:old,after_value:next},...(histories[next.id]??[])];
  return r.fulfill({status:old?200:201,json:next});
 });
 await page.goto('/');await expect(page.getByRole('heading',{name:'Velkommen tilbage'})).toBeVisible();await page.evaluate(s=>sessionStorage.setItem('lager-auth-session',JSON.stringify(s)),session);await page.reload();await expect(page.getByRole('heading',{name:'Overblik',exact:true})).toBeVisible();return rows;
}
test('customer creation, edit, deactivation, search and audit fit each viewport',async({page})=>{
 await fixture(page);await page.getByRole('button',{name:'Kunder',exact:true}).click();await page.getByRole('button',{name:'Opret ny'}).click();
 await page.getByLabel('Nummer / kode',{exact:true}).fill('C-100');await page.getByLabel('Navn',{exact:true}).fill('Customer fixture');await page.getByRole('button',{name:'Gem',exact:true}).click();
 await expect(page.getByRole('cell',{name:'Customer fixture',exact:true})).toBeVisible();await page.getByRole('button',{name:'Redigér',exact:true}).click();await page.getByLabel('Navn',{exact:true}).fill('Updated fixture');await page.getByLabel('Aktiv',{exact:true}).uncheck();page.once('dialog',d=>d.accept());await page.getByRole('button',{name:'Gem',exact:true}).click();
 await expect(page.getByText('Inaktiv',{exact:true})).toBeVisible();await page.getByRole('button',{name:'Detaljer og historik'}).click();await expect(page.getByRole('heading',{name:'Seneste 100 ændringer'})).toBeVisible();await expect(page.locator('summary')).toHaveCount(2);
 await page.getByLabel('Søg efter nummer eller navn').fill('missing');await expect(page.getByText(/Ingen resultater/)).toBeVisible();expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(page.viewportSize()!.width);
});
test('read-only users have no mutation controls',async({page})=>{
 await fixture(page,false);await page.getByRole('button',{name:'Kunder',exact:true}).click();await expect(page.getByRole('button',{name:'Opret ny'})).toHaveCount(0);await expect(page.getByText(/Ingen resultater/)).toBeVisible();
});
test('company switch unmounts drafts and does not show the previous company records',async({page})=>{
 await fixture(page);await page.getByRole('button',{name:'Kunder',exact:true}).click();await page.getByRole('button',{name:'Opret ny'}).click();await page.getByLabel('Nummer / kode',{exact:true}).fill('ONLY-A');await page.getByLabel('Navn',{exact:true}).fill('Only company A');await page.getByRole('button',{name:'Gem',exact:true}).click();await expect(page.getByRole('cell',{name:'Only company A'})).toBeVisible();await page.getByLabel('Virksomhed',{exact:true}).selectOption(other);await page.getByRole('button',{name:'Kunder',exact:true}).click();await expect(page.getByRole('cell',{name:'Only company A'})).toHaveCount(0);await expect(page.getByText(/Ingen resultater/)).toBeVisible();
});
test('creates a machine type inline while preserving the machine draft',async({page})=>{
 await fixture(page);await page.getByRole('button',{name:'Maskiner',exact:true}).click();await page.getByRole('button',{name:'Opret ny'}).click();await page.getByLabel('Nummer / kode',{exact:true}).fill('M-1');await page.getByLabel('Navn',{exact:true}).fill('Machine fixture');await page.getByRole('button',{name:'Opret maskintype',exact:true}).click();await page.getByLabel('Nummer / kode',{exact:true}).last().fill('TYPE-1');await page.getByLabel('Navn',{exact:true}).last().fill('Type fixture');await page.getByRole('button',{name:'Gem',exact:true}).last().click();await expect(page.getByLabel('Nummer / kode',{exact:true})).toHaveCount(1);await expect(page.getByLabel('Nummer / kode',{exact:true})).toHaveValue('M-1');await expect(page.getByLabel('Maskintype',{exact:true})).not.toHaveValue('');await page.getByRole('button',{name:'Gem',exact:true}).click();await expect(page.getByRole('cell',{name:'Machine fixture'})).toBeVisible();
});
