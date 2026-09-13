import {test,expect,Page} from '@playwright/test';
const company='10000000-0000-4000-8000-000000000001',other='10000000-0000-4000-8000-000000000002';
async function fixture(page:Page,transfer=true){
 const user='20000000-0000-4000-8000-000000000001';const payload=Buffer.from(JSON.stringify({sub:user,exp:Math.floor(Date.now()/1000)+3600,role:'authenticated'})).toString('base64url');
 const session={access_token:`e30.${payload}.fixture`,refresh_token:'local-refresh',token_type:'bearer',expires_in:3600,expires_at:Math.floor(Date.now()/1000)+3600,user:{id:user,aud:'authenticated',email:'fixture@example.test',user_metadata:{},app_metadata:{},created_at:new Date().toISOString()}};
 await page.route('http://127.0.0.1:54321/auth/v1/**',r=>r.fulfill({status:200,headers:{'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'*'},json:session}));
 await page.route('**/api/me',r=>r.fulfill({json:{user:{id:user,display_name:'Fixture'},memberships:[{company_id:company,name:'Test A'},{company_id:other,name:'Test B'}]}}));
 await page.route('**/api/companies/*/access',r=>r.fulfill({json:{permissions:[{code:'production.read'},{code:'inventory.read'},...(transfer?['production.deliver','production.delivery.correct','inventory.transfer','masterdata.read','production.manage'].map(code=>({code})):[])]}}));
 let closed=false;const row={id:'50000000-0000-4000-8000-000000000001',code:'CODE',name:'Fixture',active:true,kind:'company',notes:'',version:1};const bodies:any[]=[];
 await page.route(/\/api\/companies\/[^/]+\/(items|locations)/,r=>r.fulfill({json:r.request().url().includes(row.id)?{...row,path:[row],unit_id:row.id,supplier_id:row.id,standard_location_id:row.id}:{items:[row],total:1}}));
 await page.route(/\/api\/companies\/[^/]+\/inventory/,async r=>{
  const url=new URL(r.request().url());if(r.request().method()==='POST'){bodies.push(r.request().postDataJSON());if(bodies.length===1)return r.fulfill({status:503,json:{message:'Unavailable'}});return r.fulfill({status:201,json:{id:'entry'}});}
  if(url.pathname.endsWith('/history'))return r.fulfill({json:[]});
  const items=url.pathname.endsWith('/owners')?[row]:url.pathname.includes(other)?[]:url.pathname.endsWith('/balances')?[{item_id:row.id,owner_id:row.id,location_id:'60000000-0000-4000-8000-000000000001',quantity:'12.00000000',snapshot:{item:{code:'MAT',name:'Material'},owner:{name:'Company stock'},location:{name:'Shelf'},unit:{symbol:'kg'}}}]:[];
  return r.fulfill({json:{items,total:items.length}});
 });
 await page.route(/\/api\/companies\/[^/]+\/masterdata/,r=>r.fulfill({json:r.request().url().includes('/units/')?{...row,symbol:'kg',dimension:'mass'}:{items:[row],total:1}}));
 await page.route(/\/api\/companies\/[^/]+\/production-orders/,async r=>{
  const u=new URL(r.request().url());
  if(u.pathname.includes('/deliveries')){
   if(r.request().method()==='POST'){bodies.push(r.request().postDataJSON());return r.fulfill({status:bodies.length===1?503:201,json:{id:'output'}});}
   if(u.pathname.endsWith('/summary'))return r.fulfill({json:{good_quantity:'500',delivered_quantity:'100',remaining_quantity:'400',unit:{symbol:'stk.'},packing:null}});
   return r.fulfill({json:{items:[{id:row.id,kind:'delivery',quantity:'100',reversed:false,pallet_code:'PAL-TEST',created_at:'2026-09-01T00:00:00Z',comment:'Output',snapshot:{product:{name:'Product'},owner:{name:'External owner'},location:{name:'Shelf'},unit:{symbol:'stk.'}}}],total:1}});
  }
  if(u.pathname.includes('/waste')){
   if(r.request().method()==='POST'){bodies.push(r.request().postDataJSON());return r.fulfill({status:bodies.length===1?503:201,json:bodies.length===1?{message:'Unavailable'}:{id:'waste'}});}
   if(u.pathname.endsWith('/analysis'))return r.fulfill({json:{final:true,materials:[{item_id:row.id,unit_id:row.id,name:'Material',unit:'kg',consumption_owner:'bom',issued_quantity:'800',returned_quantity:'200',net_quantity:'600',theoretical_quantity:'500',difference_quantity:'100',measured_waste_quantity:'80',unexplained_quantity:'20',difference_percent:'16.66666667',waste_percent:'13.33333333',warnings:[]}]}});
   return r.fulfill({json:{items:[{id:'70000000-0000-4000-8000-000000000001',kind:'record',quantity:'80',comment:'Measured',created_at:'2026-09-13T00:00:00Z',created_by:user,snapshot:{stock:{item:{name:'Material'},owner:{name:'External owner'},unit:{symbol:'kg'}}}}],total:1}});
  }
  if(r.request().method()==='POST'){bodies.push(r.request().postDataJSON());if(bodies.length>1&&u.pathname.endsWith('/close'))closed=true;return r.fulfill({status:bodies.length===1?503:201,json:bodies.length===1?{message:'Unavailable'}:{id:'closure'}});}
  if(u.pathname.endsWith('/close/review'))return r.fulfill({json:{review_token:'a'.repeat(32),good_quantity:'500',planned_quantity:'504',materials:[{issue_id:row.id,remaining_quantity:'2',issued_quantity:'8',returned_quantity:'6',snapshot:{item:{name:'Material'},owner:{name:'External owner'},location:{name:'Machine'},unit:{symbol:'kg'}}}]}});
  if(u.pathname.endsWith('/close/result'))return r.fulfill({json:{comment:'All checked',snapshot:{good_quantity:'500',rejected_quantity:'4'}}});
  if(u.pathname.endsWith('/registrations/summary'))return r.fulfill({json:{good_quantity:'505',planned_quantity:'504',progress_percent:'100.19',overproduced:true,unit:{symbol:'stk.'}}});
  if(u.pathname.endsWith('/registrations'))return r.fulfill({json:{items:[],total:0}});
  if(u.pathname.endsWith('/material-issues/options'))return r.fulfill({json:{components:[{id:row.id}],machine_location_id:row.id}});
  if(u.pathname.endsWith('/material-issues'))return r.fulfill({json:{items:[],total:0}});
  if(u.pathname.endsWith('/history'))return r.fulfill({json:[]});
  const order={id:row.id,company_id:company,code:'PO-TEST',product:row,status:'completed',quantity:'10',version:2,problem:'',snapshot:{product:row,machine:row,unit:{symbol:'stk.'}},warnings:[],requirements:null};
  return r.fulfill({json:u.pathname.endsWith('/'+row.id)?order:{items:[order],total:1}});
 });
 await page.addInitScript(s=>sessionStorage.setItem('lager-auth-session',JSON.stringify(s)),session);
 await page.goto('/');await page.getByRole('button',{name:'Produktion',exact:true}).click();await page.getByRole('button',{name:'Åbn ordre',exact:true}).click();return{row,bodies};
}


test('reader sees delivered and remaining quantities without write controls',async({page})=>{
 await fixture(page,false);await expect(page.getByText(/Registreret godt: 500/)).toBeVisible();await expect(page.getByRole('button',{name:'Bekræft lageraflevering',exact:true})).toHaveCount(0);await expect(page.getByRole('button',{name:'Modpostér aflevering',exact:true})).toHaveCount(0);
});
test('delivery preserves exact command after an uncertain response',async({page})=>{
 const {row,bodies}=await fixture(page);await page.getByLabel('Antal til lager',{exact:true}).fill('100');await page.getByLabel('Færdigvarernes ejer',{exact:true}).selectOption(row.id);await page.getByLabel('Færdigvareplacering',{exact:true}).selectOption(row.id);await page.getByLabel('Produktionsdato',{exact:true}).fill('2026-09-01');page.on('dialog',d=>void d.accept());await page.getByRole('button',{name:'Bekræft lageraflevering',exact:true}).click();await expect(page.getByLabel('Antal til lager',{exact:true})).toBeDisabled();await page.getByRole('button',{name:'Prøv samme aflevering igen',exact:true}).click();await expect(page.getByLabel('Antal til lager',{exact:true})).toHaveValue('');expect(bodies).toHaveLength(2);expect(bodies[0]).toEqual(bodies[1]);expect(bodies[0].quantity).toBe('100');
});
test('output reversal requires reason and preserves retry identity',async({page})=>{
 const {bodies}=await fixture(page);page.on('dialog',d=>void d.accept('Incorrect output'));await page.getByRole('button',{name:'Modpostér aflevering',exact:true}).click();await expect(page.getByRole('button',{name:'Modpostér aflevering',exact:true})).toBeDisabled();await page.getByRole('button',{name:'Prøv samme aflevering igen',exact:true}).click();await expect(page.getByRole('button',{name:'Modpostér aflevering',exact:true})).toBeEnabled();expect(bodies[0]).toEqual(bodies[1]);
});

test('pallet navigation shows identified stock and retries a whole-pallet move',async({page})=>{
 const pageErrors:string[]=[];page.on('pageerror',e=>pageErrors.push(e.message));
 const {row}=await fixture(page);const bodies:any[]=[];
 await page.route(/\/api\/companies\/[^/]+\/handling-units/,async r=>{
  if(r.request().method()==='POST'){bodies.push(r.request().postDataJSON());return r.fulfill({status:bodies.length===1?503:201,json:{id:'move'}});}
  if(new URL(r.request().url()).pathname.endsWith('/moves'))return r.fulfill({json:{items:[]}});
  return r.fulfill({json:{total:1,items:[{id:row.id,company_id:company,code:'PAL-TEST',active:true,quantity:'100',location_id:row.id,current_location:{name:'Shelf'},order_id:row.id,snapshot:{order_code:'PO-TEST',product:{name:'Product'},owner:{name:'Owner'},unit:{symbol:'stk.'}}}]}});
 });
 await page.getByRole('button',{name:'Pallestyring',exact:true}).click();await expect(page.getByText(/PAL-TEST/)).toBeVisible();await page.getByRole('button',{name:'Vis pallehistorik / flyt',exact:true}).click();await page.getByLabel('Pallens nye placering',{exact:true}).selectOption(row.id);await page.getByLabel('Flyttekommentar',{exact:true}).fill('Move complete pallet');page.on('dialog',d=>void d.accept());await page.getByRole('button',{name:'Flyt hele pallen',exact:true}).click();await expect(page.getByLabel('Flyttekommentar',{exact:true})).toBeDisabled().catch(async e=>{throw new Error(String(e)+'; page errors: '+JSON.stringify(pageErrors)+'; fixture page: '+await page.locator('body').innerText());});await page.getByRole('button',{name:'Prøv samme palleflytning igen',exact:true}).click();await expect(page.getByLabel('Flyttekommentar',{exact:true})).toHaveValue('');expect(bodies).toHaveLength(2);expect(bodies[0]).toEqual(bodies[1]);
});
