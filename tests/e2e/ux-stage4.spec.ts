import {chooseReference} from './ux-helpers';
import {openWorkspace} from './ux-helpers';
import {test,expect,Page} from '@playwright/test';
const company='10000000-0000-4000-8000-000000000001',other='10000000-0000-4000-8000-000000000002',id='50000000-0000-4000-8000-000000000001';
async function fixture(page:Page){
 const user='20000000-0000-4000-8000-000000000001';const payload=Buffer.from(JSON.stringify({sub:user,exp:Math.floor(Date.now()/1000)+3600,role:'authenticated'})).toString('base64url');
 const session={access_token:`e30.${payload}.fixture`,refresh_token:'local-refresh',token_type:'bearer',expires_in:3600,expires_at:Math.floor(Date.now()/1000)+3600,user:{id:user,aud:'authenticated',email:'fixture@example.test',user_metadata:{},app_metadata:{},created_at:new Date().toISOString()}};
 await page.route('http://127.0.0.1:54321/auth/v1/**',r=>r.fulfill({status:200,headers:{'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'*'},json:session}));
 await page.route('**/api/me',r=>r.fulfill({json:{user:{id:user,display_name:'Fixture'},memberships:[{company_id:company,name:'Test A'},{company_id:other,name:'Test B'}]}}));
 await page.route('**/api/companies/*/access',r=>r.fulfill({json:{permissions:['production.read','production.manage','masterdata.read','inventory.read','inventory.transfer','production.issue','production.record','production.correct','production.return','production.close','production.waste','production.waste.correct','production.deliver','production.delivery.correct'].map(code=>({code}))}}));
 const row={id,code:'FIX',name:'Fixture',active:true,is_storage:true};let status='draft',version=1,good=0,delivered=0,returned=0;const commands:{path:string;body:any}[]=[];
 const order=()=>({id,product_id:id,code:'FLOW',quantity:'10',status,version,problem:'',notes:'',product:row,snapshot:{product:row,machine:row,unit:{symbol:'stk.'}},warnings:[],requirements:null});
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
test('stage4 complete task journey keeps registration delivery return waste and closure distinct',async({page})=>{
 const {commands}=await fixture(page);const task=async(name:string)=>page.getByRole('navigation',{name:'Produktionsopgaver'}).getByRole('button',{name,exact:true}).click();page.on('dialog',d=>void d.accept());
 await expect(page.getByLabel('Nye gode emner')).not.toBeVisible();await page.getByRole('button',{name:'Markér planlagt',exact:true}).click();await expect(page.getByRole('button',{name:'Markér klar',exact:true})).toBeVisible();
 await task('Udlever materiale');await page.getByRole('button',{name:'Send materiale til produktion',exact:true}).click();await page.getByLabel('Fra beholdning',{exact:true}).selectOption({index:1});await page.getByLabel('Mængde',{exact:true}).fill('5');await page.getByRole('button',{name:'Bekræft lagerflytning'}).click();await expect(page.getByLabel('Mængde',{exact:true})).toHaveCount(0);
 await task('Ordre og klargøring');await page.getByRole('button',{name:'Markér klar',exact:true}).click();await page.getByRole('button',{name:'Start produktion',exact:true}).click();await expect(page.getByText(/Næste trin: Registrér nye/)).toBeVisible();
 await task('Registrér produktion');await page.getByLabel('Nye gode emner').fill('4');await page.getByRole('button',{name:'Registrér gode emner',exact:true}).click();await expect(page.getByText(/Gode emner: 4 \/ 10/)).toBeVisible();
 await task('Aflever til lager');await expect(page.getByText(/Registreret godt: 4 · Afleveret: 0/)).toBeVisible();await page.getByLabel('Antal til lager').fill('3');await chooseReference(page,'Færdigvarernes ejer',id);await page.getByLabel('Færdigvareplacering',{exact:true}).selectOption(id);await page.getByRole('button',{name:'Bekræft lageraflevering'}).click();await expect(page.getByText(/Afleveret: 3 · Kan afleveres: 1/)).toBeVisible();
 await task('Registrér produktion');await page.getByLabel('Nye gode emner').fill('6');await page.getByRole('button',{name:'Registrér gode emner',exact:true}).click();await expect(page.getByText(/Gode emner: 10 \/ 10/)).toBeVisible();
 await task('Registrér spild');await page.getByLabel('Spildets materialeudlevering',{exact:true}).selectOption(id);await page.getByLabel('Målt spildmængde').fill('0,25');await page.getByLabel('Spildkommentar').fill('Measured scrap');await page.getByRole('button',{name:'Registrér fysisk spild'}).click();await expect(page.getByLabel('Målt spildmængde')).toHaveValue('');
 await task('Retur og afslutning');await page.getByText('Returnér ubrugt materiale',{exact:true}).click();await page.getByLabel('Udlevering til retur',{exact:true}).selectOption(id);await page.getByLabel('Returplacering',{exact:true}).selectOption(id);await page.getByLabel('Returmængde').fill('1');await page.getByLabel('Returkommentar').fill('Unused material');await page.getByRole('button',{name:'Returnér materiale',exact:true}).click();await expect(page.getByLabel('Returmængde')).toHaveValue('');
 await page.getByRole('button',{name:'Begynd afstemning'}).click();await page.getByLabel('Afslutningskommentar og afvigelser').fill('All checked');await page.getByRole('checkbox',{name:/Jeg har kontrolleret/}).check();await page.getByRole('button',{name:'Afslut produktion',exact:true}).click();await expect(page.getByText(/Produktionen er afsluttet og låst/)).toBeVisible();
 expect(commands.map(c=>c.path)).toEqual(['/status','/material-issues','/status','/status','/registrations','/deliveries','/registrations','/waste','/close/returns','/status','/close']);
 expect(commands[1].body).toMatchObject({quantity:'5',owner_id:id,from_location_id:other,to_location_id:id});expect(commands[4].body.quantity).toBe('4');expect(commands[5].body).toMatchObject({quantity:'3',owner_id:id,location_id:id});expect(commands[6].body.quantity).toBe('6');expect(commands[7].body.quantity).toBe('0.25');expect(commands[8].body).toMatchObject({issue_id:id,quantity:'1'});expect(commands[10].body).toMatchObject({confirm_materials:true,review_token:'a'.repeat(32),rejected_quantity:'0'});
 await task('Aflever til lager');await expect(page.getByText(/Registreret godt: 10 · Afleveret: 3 · Kan afleveres: 7/)).toBeVisible();const menu=page.getByRole('button',{name:'Menu',exact:true});if(await menu.isVisible())await menu.click();await page.getByLabel('Virksomhed',{exact:true}).selectOption(other);await openWorkspace(page,'Produktion');await expect(page.getByRole('navigation',{name:'Produktionsopgaver'})).toHaveCount(0);expect(commands).toHaveLength(11);
});
