import {test,expect,Page} from '@playwright/test';
const company='10000000-0000-4000-8000-000000000001',other='10000000-0000-4000-8000-000000000002',id='50000000-0000-4000-8000-000000000001';
async function fixture(page:Page,manage=true){
 const user='20000000-0000-4000-8000-000000000001';const payload=Buffer.from(JSON.stringify({sub:user,exp:Math.floor(Date.now()/1000)+3600,role:'authenticated'})).toString('base64url');
 const session={access_token:`e30.${payload}.fixture`,refresh_token:'local-refresh',token_type:'bearer',expires_in:3600,expires_at:Math.floor(Date.now()/1000)+3600,user:{id:user,aud:'authenticated',email:'fixture@example.test',user_metadata:{},app_metadata:{},created_at:new Date().toISOString()}};
 await page.route('http://127.0.0.1:54321/auth/v1/**',r=>r.fulfill({status:200,headers:{'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'*'},json:session}));
 await page.route('**/api/me',r=>r.fulfill({json:{user:{id:user,display_name:'Fixture'},memberships:[{company_id:company,name:'Test A'},{company_id:other,name:'Test B'}]}}));
 await page.route('**/api/companies/*/access',r=>r.fulfill({json:{permissions:[{code:'production.read'},...(manage?[{code:'production.manage'},{code:'masterdata.read'}]:[])]}}));
 const row={id,code:'P',name:'Product',active:true};const bodies:any[]=[];
 let order:any={id,company_id:company,product_id:id,code:'PO-1',quantity:'504',status:'draft',version:1,problem:'',notes:'',priority:0,customer_id:null,machine_id:id,bom_revision_id:id,packing_revision_id:id,planned_start:null,deadline:null,product:row,machine:row,snapshot:{product:row,machine:row,unit:{symbol:'stk.'}},warnings:[],requirements:{materials:[{component_id:'mat',name:'Material',unit:'kg',quantity:'4.158'}],packaging:[],containers:[]}};
 await page.route(/\/api\/companies\/[^/]+\/(items|masterdata)/,r=>r.fulfill({json:{items:[row],total:1}}));
 await page.route(/\/api\/companies\/[^/]+\/recipes/,r=>r.fulfill({json:{lines:[{component_id:'box',quantity:'12',kind:'container',level:0,snapshot:{name:'Box'}}]}}));
 await page.route(/\/api\/companies\/[^/]+\/production-orders/,async r=>{
  const u=new URL(r.request().url());
  if(r.request().method()==='POST'){
   const b=r.request().postDataJSON();bodies.push(b);
   if(u.pathname.endsWith('/status')){order={...order,status:b.status,version:order.version+1};return r.fulfill({status:201,json:order});}
   if(bodies.length===1)return r.fulfill({status:503,json:{message:'Unavailable'}});
   return r.fulfill({status:201,json:order});
  }
  if(u.pathname.includes('/defaults/'))return r.fulfill({json:{customer_id:null,machine_id:id,bom_revision_id:id,packing_revision_id:id,notes:'',recipes:[{id:'bom',name:'Standard BOM',kind:'bom',current_revision_id:id},{id:'pack',name:'Standard packing',kind:'packing',current_revision_id:id}]}});
  if(u.pathname.endsWith('/history'))return r.fulfill({json:[]});
  if(u.pathname.endsWith('/'+id))return r.fulfill({json:order});
  return r.fulfill({json:{items:u.pathname.includes(other)?[]:[order],total:u.pathname.includes(other)?0:1}});
 });
 await page.addInitScript(s=>sessionStorage.setItem('lager-auth-session',JSON.stringify(s)),session);
 await page.goto('/');await page.getByRole('button',{name:'Produktion',exact:true}).click();return{bodies};
}
test('production reader sees requirements and company-specific lists without write actions',async({page})=>{
 await fixture(page,false);await page.getByRole('button',{name:'Åbn ordre',exact:true}).click();await expect(page.getByRole('heading',{name:'Beregnet behov'})).toBeVisible();await expect(page.getByText('4.158',{exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'Ny produktionsordre',exact:true})).toHaveCount(0);await expect(page.getByRole('button',{name:'Markér planlagt'})).toHaveCount(0);
 await page.getByLabel('Virksomhed',{exact:true}).selectOption(other);await page.getByRole('button',{name:'Produktion',exact:true}).click();await expect(page.getByText('Ingen produktionsordrer fundet.')).toBeVisible();
});
test('loads defaults, retries identical creation, displays needs and confirms planning',async({page})=>{
 const{bodies}=await fixture(page);await page.getByRole('button',{name:'Ny produktionsordre',exact:true}).click();await page.getByLabel('Vare',{exact:true}).selectOption(id);await expect(page.getByLabel('Maskine',{exact:true})).toHaveValue(id);await page.getByLabel('Ordrenummer',{exact:true}).fill('PO-1');await page.getByLabel('Planlagt antal',{exact:true}).fill('504');await page.getByRole('button',{name:'Gem kladde',exact:true}).click();await expect(page.getByRole('alert')).toBeVisible();await expect(page.getByLabel('Planlagt antal',{exact:true})).toBeDisabled();await page.getByRole('button',{name:'Prøv samme anmodning igen'}).click();await expect(page.getByRole('heading',{name:'Beregnet behov'})).toBeVisible();expect(bodies[0]).toEqual(bodies[1]);expect(bodies[0].machine_id).toBe(id);expect(bodies[0].bom_revision_id).toBe(id);
 page.once('dialog',d=>{expect(d.message()).toContain('Lageret ændres ikke');void d.accept();});await page.getByRole('button',{name:'Markér planlagt',exact:true}).click();await expect(page.getByRole('button',{name:'Markér klar',exact:true})).toBeVisible();expect(bodies[2]).toEqual({version:1,status:'planned'});await page.getByRole('button',{name:'Vis Kanban'}).click();await expect(page.getByRole('heading',{name:'Planlagt',exact:true})).toBeVisible();
});
