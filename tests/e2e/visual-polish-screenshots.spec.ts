import {test,expect,type Page} from '@playwright/test';
import {openWorkspace,chooseReference} from './ux-helpers';
const company='10000000-0000-4000-8000-000000000001',other='10000000-0000-4000-8000-000000000002',id='50000000-0000-4000-8000-000000000001';
const output=(process.env.VISUAL_SCREENSHOT_DIR??'test-results/visual-polish')+'/';
async function capture(page:Page,name:string){await page.evaluate(()=>{(document.activeElement as HTMLElement)?.blur();window.scrollTo(0,0);});await page.screenshot({path:output+name+'.png',fullPage:true});}
async function fixture(page:Page,full=true){
 const id='20000000-0000-4000-8000-000000000001',company='10000000-0000-4000-8000-000000000001';
 const session={access_token:`e30.${Buffer.from(JSON.stringify({sub:id,exp:Math.floor(Date.now()/1000)+3600,role:'authenticated'})).toString('base64url')}.fixture`,refresh_token:'local',token_type:'bearer',expires_in:3600,expires_at:Math.floor(Date.now()/1000)+3600,user:{id,aud:'authenticated',email:'test@example.test',user_metadata:{},app_metadata:{},created_at:'2026-01-01'}};
 const permissions=full?['dashboard.read','inventory.read','masterdata.read','masterdata.manage','production.read','shipments.read','inventory.receive']:['dashboard.read'];
 const writes:string[]=[];
 await page.route('http://127.0.0.1:54321/auth/v1/**',r=>r.fulfill({json:session}));
 await page.route('**/api/**',r=>{const path=new URL(r.request().url()).pathname;if(r.request().method()!=='GET')writes.push(path);
 if(path==='/api/me')return r.fulfill({json:{user:{id,display_name:'Kristoffer'},memberships:[{company_id:company,name:'Pilotvirksomhed'}]}});
 if(path.endsWith('/access'))return r.fulfill({json:{permissions:permissions.map(code=>({code}))}});
 if(path.endsWith('/dashboard'))return r.fulfill({json:{company_id:company,as_of:'2026-09-25T10:00:00Z',day:'2026-09-25',limited:[],permissions,alerts:[],orders:full?[{id:'order',code:'PO-1023',status:'in_production',product:'Plastemne',quantity:'1000'}]:[],shipments:[],receipts:[]}});
 const row={id:'50000000-0000-4000-8000-000000000001',code:'MAT-001',name:'PP Granulat',active:true,is_storage:true,symbol:'kg',dimension:'mass',kind:'company',unit_id:'50000000-0000-4000-8000-000000000001'};
 if(path.endsWith('/inventory/balances'))return r.fulfill({json:{items:[{item_id:row.id,owner_id:row.id,location_id:row.id,quantity:'2450.00000000',snapshot:{item:{code:'VR-1001',name:'Plastemne 120 mm'},owner:{name:'Eget lager'},location:{name:'Færdigvarer'},unit:{symbol:'stk'}}}],total:1}});
 if(path.includes('/items/')||path.includes('/locations')||path.includes('/masterdata/units')||path.endsWith('/inventory/owners'))return r.fulfill({json:path.endsWith(row.id)?{...row,path:[row]}:{items:[{...row,name:path.includes('/locations')?'Råvarelager':path.endsWith('/inventory/owners')?'Eget lager':path.includes('/units')?'Kilogram':row.name}],total:1}});
 return r.fulfill({json:{items:[],total:0}});
 });
 await page.addInitScript(s=>sessionStorage.setItem('lager-auth-session',JSON.stringify(s)),session);await page.goto('/');await expect(page.getByText('Dagens overblik',{exact:true})).toBeVisible();return{writes};
}
async function productionFixture(page:Page){
 const user='20000000-0000-4000-8000-000000000001';const payload=Buffer.from(JSON.stringify({sub:user,exp:Math.floor(Date.now()/1000)+3600,role:'authenticated'})).toString('base64url');
 const session={access_token:`e30.${payload}.fixture`,refresh_token:'local-refresh',token_type:'bearer',expires_in:3600,expires_at:Math.floor(Date.now()/1000)+3600,user:{id:user,aud:'authenticated',email:'fixture@example.test',user_metadata:{},app_metadata:{},created_at:new Date().toISOString()}};
 await page.route('http://127.0.0.1:54321/auth/v1/**',r=>r.fulfill({status:200,headers:{'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'*'},json:session}));
 await page.route('**/api/me',r=>r.fulfill({json:{user:{id:user,display_name:'Kristoffer'},memberships:[{company_id:company,name:'Test A'},{company_id:other,name:'Test B'}]}}));
 await page.route('**/api/companies/*/access',r=>r.fulfill({json:{permissions:['production.read','production.manage','masterdata.read','inventory.read','inventory.transfer','production.issue','production.record','production.correct','production.return','production.close','production.waste','production.waste.correct','production.deliver','production.delivery.correct'].map(code=>({code}))}}));
 const row={id,code:'FIX',name:'Plastemne 120 mm',active:true,is_storage:true};let status='in_production',version=1,good=4,delivered=0,returned=0;const commands:{path:string;body:any}[]=[];
 const order=()=>({id,product_id:id,code:'PO-1023',quantity:'10',status,version,problem:'',notes:'',product:row,snapshot:{product:row,machine:row,unit:{symbol:'stk.'}},warnings:[],requirements:null});
 await page.route(/\/api\/companies\/[^/]+\/(masterdata|locations|inventory)/,r=>{const p=new URL(r.request().url()).pathname;return r.fulfill({json:p.endsWith('/balances')?{items:[{item_id:id,owner_id:id,location_id:other,quantity:'20',snapshot:{item:row,owner:row,location:row,unit:{symbol:'kg'}}}],total:1}:p.endsWith('/'+id)?{...row,path:[row]}:{items:[row],total:1}});});
 await page.route(/\/api\/companies\/[^/]+\/production-orders/,r=>{
 const p=new URL(r.request().url()).pathname,part=p.split('/'+id)[1]??'';
 if(r.request().method()==='POST'){
 const b=r.request().postDataJSON();commands.push({path:part,body:b});
 if(part==='/status'){status=b.status;version++;}if(part==='/registrations')good+=Number(b.quantity);if(part==='/deliveries')delivered+=Number(b.quantity);if(part==='/close/returns')returned+=Number(b.quantity);if(part==='/close'){status='completed';version++;}
 return r.fulfill({status:201,json:{id}});
 }
 if(p.includes(other))return r.fulfill({json:{items:[],total:0}});
 if(part==='/history')return r.fulfill({json:[]});
 if(part==='/registrations/summary')return r.fulfill({json:{good_quantity:String(good),planned_quantity:'10',progress_percent:String(good*10),unit:{symbol:'stk.'}}});
 if(part==='/deliveries/summary')return r.fulfill({json:{good_quantity:String(good),delivered_quantity:String(delivered),remaining_quantity:String(good-delivered),unit:{symbol:'stk.'},packing:null}});
 if(part==='/close/review')return r.fulfill({json:{review_token:'a'.repeat(32),good_quantity:String(good),planned_quantity:'10',materials:[{issue_id:id,issued_quantity:'5',returned_quantity:String(returned),remaining_quantity:String(5-returned),snapshot:{item:row,owner:row,location:row,unit:{symbol:'kg'}}}]}});
 if(part==='/close/result')return r.fulfill({json:{comment:'Checked',snapshot:{good_quantity:String(good),rejected_quantity:'0'}}});
 if(part==='/waste/analysis')return r.fulfill({json:{final:status==='completed',materials:[]}});
 if(part==='/material-issues/options')return r.fulfill({json:{components:[{id}],machine_location_id:id}});
 if(part)return r.fulfill({json:{items:[],total:0}});
 return r.fulfill({json:p.endsWith('/'+id)?order():{items:[order()],total:1}});
 });
 await page.addInitScript(s=>sessionStorage.setItem('lager-auth-session',JSON.stringify(s)),session);await page.goto('/');await openWorkspace(page,'Produktion');await page.getByRole('button',{name:'Åbn ordre',exact:true}).click();return {commands};
}

test('seven mockup comparison screenshots use only local fixtures',async({page},info)=>{
 test.skip(info.project.name==='tablet','Screenshot request covers desktop and mobile; tablet covered by flow tests.');
 if(info.project.name==='mobile'){await fixture(page);await capture(page,'06-mobilforside');await openWorkspace(page,'Scan QR');await expect(page.getByRole('button',{name:'Start kamera'})).toBeVisible();await capture(page,'07-mobil-scanning');return;}
 await fixture(page);await capture(page,'01-dashboard-desktop');
 await openWorkspace(page,'Varer');await page.getByRole('button',{name:'Opret ny'}).click();await page.getByLabel('Nummer',{exact:true}).fill('VR-1001');await page.getByLabel('Navn',{exact:true}).fill('Plastemne 120 mm');await expect(page.getByRole('heading',{name:'Opret vare',exact:true})).toBeVisible();await capture(page,'02-opret-vare-desktop');
 await openWorkspace(page,'Modtagelse');await page.getByRole('button',{name:'Ny modtagelse'}).click();await chooseReference(page,'Vare',id);await page.getByLabel('Modtaget mængde').fill('1000');await page.getByLabel('Placering',{exact:true}).selectOption(id);await capture(page,'03-modtagelse-desktop');
 await openWorkspace(page,'Lager');await expect(page.getByText('Plastemne 120 mm',{exact:false}).first()).toBeVisible();await capture(page,'05-lageroversigt-desktop');
 await page.unrouteAll({behavior:'wait'});await productionFixture(page);await page.getByRole('navigation',{name:'Produktionsopgaver'}).getByRole('button',{name:'Registrér produktion',exact:true}).click();await expect(page.getByLabel('Nye gode emner')).toBeVisible();await capture(page,'04-produktionsordre-desktop');
});
