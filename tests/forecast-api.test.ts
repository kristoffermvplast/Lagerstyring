import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {beforeAll,afterAll,it,expect} from 'vitest';
import {fixture,ids,asUser} from './helpers/access-fixture';
const require=createRequire(import.meta.url),{ForecastController}=require('../apps/api/dist/forecast.js');
let db:Awaited<ReturnType<typeof fixture>>,service:any,forecast:any,item:string,unit:string,pcs:string,owner:string,location:string,target:string,box:string,product:string,machine:string,bom:string,packing:string,order:any,issue:any;
const actor={userId:ids.adminA,sessionId:ids.session},reader={userId:ids.reader,sessionId:ids.sessionRead},key=()=>crypto.randomUUID();
const admin=<T>(work:()=>Promise<T>)=>asUser(db,ids.adminA,ids.a,work);
const future=(days:number)=>new Date(Date.now()+days*86400000).toISOString().slice(0,10);
const to=future(90);
const get=(extra:object={},a=actor,c=ids.a)=>forecast.preview({actor:a},c,{item_id:item,owner_id:owner,to,...extra});
const grant=async(...codes:string[])=>{for(const code of codes)await db.query('insert into app.role_permissions values($1,$2,$3) on conflict do nothing',[ids.a,ids.readRole,code]);};
const correction=(quantity:string,i=item)=>new (require('../apps/api/dist/inventory.js').InventoryController)(service).correction({actor},ids.a,{idempotency_key:key(),reason:'Report fixture',reference:'REF',lines:[{item_id:i,owner_id:owner,location_id:location,quantity}]});
beforeAll(async()=>{
 db=await fixture();const {DatabaseService}=require('../apps/api/dist/database.js'),{loadConfig}=require('../apps/api/dist/config.js');service=new DatabaseService(loadConfig({NODE_ENV:'test'}));service.pool={connect:async()=>({query:async(sql:string,values?:unknown[])=>{if(sql.startsWith('BEGIN')){await db.exec('BEGIN; SET LOCAL ROLE app_backend;');return{rows:[]};}const r=await db.query(sql,values);return{rows:r.rows};},release:()=>{}})};forecast=new ForecastController(service);
 await admin(async()=>{
 unit=(await db.query<any>("insert into app.units(company_id,code,name,symbol,dimension) values($1,'KG','Kilogram','kg','mass') returning id",[ids.a])).rows[0].id;
 pcs=(await db.query<any>("insert into app.units(company_id,code,name,symbol,dimension) values($1,'PCS','Pieces','pcs','count') returning id",[ids.a])).rows[0].id;
 item=(await db.query<any>("insert into app.items(company_id,kind,code,name,unit_id) values($1,'material','R%_','Historical material',$2) returning id",[ids.a,unit])).rows[0].id;
 box=(await db.query<any>("insert into app.items(company_id,kind,code,name,unit_id) values($1,'packaging','BOX','Box',$2) returning id",[ids.a,pcs])).rows[0].id;
 owner=(await db.query<any>("insert into app.stock_owners(company_id,code,name,kind) values($1,'OWN','Owner','company') returning id",[ids.a])).rows[0].id;
 location=(await db.query<any>("insert into app.locations(company_id,code,name) values($1,'L','Warehouse') returning id",[ids.a])).rows[0].id;
 target=(await db.query<any>("insert into app.locations(company_id,code,name) values($1,'T','Machine area') returning id",[ids.a])).rows[0].id;
 machine=(await db.query<any>("insert into app.machines(company_id,code,name,location_id) values($1,'RM','Machine',$2) returning id",[ids.a,target])).rows[0].id;
 product=(await db.query<any>("insert into app.items(company_id,kind,code,name,unit_id) values($1,'product','RP','Product',$2) returning id",[ids.a,pcs])).rows[0].id;
 for(const kind of ['bom','packing']){
 const r=(await db.query<any>('insert into app.recipes(company_id,product_id,kind,name) values($1,$2,$3,$3) returning id',[ids.a,product,kind])).rows[0].id;
 const v=(await db.query<any>('insert into app.recipe_revisions(company_id,recipe_id,revision) values($1,$2,1) returning id',[ids.a,r])).rows[0].id;
 await db.query('insert into app.recipe_lines(company_id,revision_id,component_id,kind,quantity) values($1,$2,$3,$4,$5)',[ids.a,v,kind==='bom'?item:box,kind==='bom'?'component':'container',kind==='bom'?'0.5':'10']);await db.query('update app.recipe_revisions set sealed=true where id=$1',[v]);if(kind==='bom')bom=v;else packing=v;
 }
 });await correction('100.00000001');await correction('100',box);
});
afterAll(async()=>{await db?.close();});
it('reads only the selected item/owner and preserves source snapshots without business writes',async()=>{
 const before=await db.query('select count(*)::int n from app.inventory_entries');
 const r=await get();expect(r.company_id).toBe(ids.a);expect(r.physical).toBe('100.00000001');expect(r.projected_available).toBe('100.00000001');expect(r.timeline).toEqual([]);expect(r.item.unit_id).toBe(unit);expect(r.sources.balances).toHaveLength(1);
 const {sha256,...payload}=r;expect(sha256).toBe(createHash('sha256').update(JSON.stringify(payload)).digest('hex'));expect(await db.query('select count(*)::int n from app.inventory_entries')).toEqual(before);
});
it('checks all source permissions, tenant isolation and unknown IDs',async()=>{
 await expect(get({},reader)).rejects.toMatchObject({status:403});await grant('inventory.read','production.read','masterdata.read');await expect(get({},reader)).rejects.toMatchObject({status:403});await grant('shipments.read');expect((await get({},reader)).physical).toBe('100.00000001');
 await expect(get({},actor,ids.b)).rejects.toMatchObject({status:403});await expect(get({}, {userId:ids.adminB,sessionId:ids.sessionB},ids.b)).rejects.toMatchObject({status:404});
 for(const extra of [{item_id:key()},{owner_id:key()},{production_order_ids:[key()]},{production_reservation_ids:[key()]}])await expect(get(extra)).rejects.toMatchObject({status:404});
});
it('validates dates, duplicate sources, positive exact quantities, whole units and strict bodies',async()=>{
 for(const extra of [{to:'2026-02-30'},{to:'9999-01-01'},{to:'2000-01-01'},{arrivals:[{date:to,reference:'A',quantity:'0'}]},{arrivals:[{date:to,reference:'A',quantity:'1e2'}]},{production_order_ids:[item,item]},{production_reservation_ids:[item,item]},{arrivals:[{date:to,reference:'A',quantity:'1'},{date:to,reference:'a',quantity:'2'}]},{arrivals:[{date:future(91),reference:'A',quantity:'1'}]},{arrivals:[{date:'2000-01-01',reference:'A',quantity:'1'}]},{item_id:box,arrivals:[{date:to,reference:'A',quantity:'0.5'}]},{invented:true}])await expect(async()=>get(extra)).rejects.toBeDefined();
});
it('adds only remaining scenario supply and keeps its explicit assumption/reference',async()=>{
 const r=await get({arrivals:[{date:to,reference:'Supplier delivery remainder',quantity:'0.00000001'}]});expect(r.projected_available).toBe('100.00000002');expect(r.timeline[0]).toMatchObject({kind:'arrival',reference:'Supplier delivery remainder'});expect(r.assumptions.join(' ')).toContain('gemmes ikke');
});
const prod=()=>new (require('../apps/api/dist/production-orders.js').ProductionOrdersController)(service);
it('calculates remaining production need from sealed BOM and net issue, including return and reversal',async()=>{
 order=await prod().create({actor},ids.a,{idempotency_key:key(),product_id:product,code:'FORECAST-ORDER',quantity:'10',machine_id:machine,bom_revision_id:bom,packing_revision_id:packing,planned_start:future(2)+'T12:00:00Z'});
 for(const status of ['planned','ready','in_production'])order=await prod().status({actor},ids.a,order.id,{version:order.version,status});
 const issues=new (require('../apps/api/dist/material-issues.js').MaterialIssuesController)(service),close=new (require('../apps/api/dist/production-close.js').ProductionCloseController)(service);
 issue=await issues.issue({actor},ids.a,order.id,{idempotency_key:key(),item_id:item,owner_id:owner,from_location_id:location,to_location_id:target,quantity:'3',comment:'Forecast issue'});
 let r=await get({production_order_ids:[order.id]});expect(r.physical).toBe('100.00000001');expect(r.in_production).toBe('3');expect(r.remaining_demand).toBe('2');expect(r.projected_available).toBe('95.00000001');expect(r.sources.production[0]).toMatchObject({full_requirement:'5',net_issued_all_owners:'3',remaining_requirement:'2'});
 const returned=await close.returnMaterial({actor},ids.a,order.id,{idempotency_key:key(),issue_id:issue.id,to_location_id:location,quantity:'1',comment:'Return fixture material'});
 r=await get({production_order_ids:[order.id]});expect(r.in_production).toBe('2');expect(r.remaining_demand).toBe('3');expect(r.projected_available).toBe('95.00000001');
 const inventory=new (require('../apps/api/dist/inventory.js').InventoryController)(service);await inventory.reverse({actor},ids.a,returned.id,{idempotency_key:key(),reason:'Reverse return'});
 r=await get({production_order_ids:[order.id]});expect(r.in_production).toBe('3');expect(r.remaining_demand).toBe('2');
 await inventory.reverse({actor},ids.a,issue.id,{idempotency_key:key(),reason:'Reverse original issue'});
 r=await get({production_order_ids:[order.id]});expect(r.in_production).toBe('0');expect(r.remaining_demand).toBe('5');expect(r.projected_available).toBe('95.00000001');
});
let reserve:any;
it('modregner only explicitly linked free production reservations and never frees excess holds',async()=>{
 const reservations=new (require('../apps/api/dist/reservations.js').ReservationsController)(service);
 reserve=await reservations.create({actor},ids.a,{idempotency_key:key(),item_id:item,owner_id:owner,location_id:location,quantity:'8',reference:'Production allocation',reason:'Forecast reserved fixture'});
 let r=await get({production_order_ids:[order.id]});expect(r.projected_available).toBe('87.00000001');
 r=await get({production_order_ids:[order.id],production_reservation_ids:[reserve.id]});expect(r.reservation_credit).toBe('5');expect(r.projected_available).toBe('92.00000001');expect(r.sources.production_reservations[0].id).toBe(reserve.id);
 await expect(get({production_reservation_ids:[reserve.id]})).rejects.toMatchObject({status:400});
 await reservations.release({actor},ids.a,reserve.id,{idempotency_key:key(),reason:'Release fixture'});await expect(get({production_order_ids:[order.id],production_reservation_ids:[reserve.id]})).rejects.toMatchObject({status:404});
});
it('shipment demand is unchanged by reserving; dispatch/cancel removes future demand and no reservation is counted twice',async()=>{
 const customer=await admin(async()=>(await db.query<any>("insert into app.customers(company_id,code,name) values($1,'FC','Forecast customer') returning id",[ids.a])).rows[0].id);
 const shipments=new (require('../apps/api/dist/shipments.js').ShipmentsController)(service);let s=await shipments.create({actor},ids.a,{idempotency_key:key(),version:0,reason:'Forecast shipment',data:{code:'FS',customer_id:customer,ship_date:future(3),lines:[{item_id:item,owner_id:owner,location_id:location,quantity:'10'}]}});
 expect((await get()).remaining_demand).toBe('0');
 s=await shipments.transition({actor},ids.a,s.id,'plan',{idempotency_key:key(),version:s.version,reason:'Plan fixture'});expect((await get()).projected_available).toBe('90.00000001');
 s=await shipments.transition({actor},ids.a,s.id,'reserve',{idempotency_key:key(),version:s.version,reason:'Reserve fixture'});let r=await get();expect(r.projected_available).toBe('90.00000001');expect(r.reservation_credit).toBe('10');
 const linked=(await db.query<any>('select reservation_id from app.shipment_reservations where shipment_id=$1',[s.id])).rows[0].reservation_id;
 await expect(get({production_order_ids:[order.id],production_reservation_ids:[linked]})).rejects.toMatchObject({status:404});
 s=await shipments.transition({actor},ids.a,s.id,'ready',{idempotency_key:key(),version:s.version,reason:'Ready fixture'});s=await shipments.transition({actor},ids.a,s.id,'dispatch',{idempotency_key:key(),version:s.version,reason:'Dispatch fixture'});
 r=await get();expect(r.projected_available).toBe('90.00000001');expect(r.remaining_demand).toBe('0');expect(r.reservation_credit).toBe('0');
});
it('keeps owner pools separate, yet nets already issued material across owners for a selected order',async()=>{
 const otherOwner=await admin(async()=>(await db.query<any>("insert into app.stock_owners(company_id,code,name,kind) values($1,'OTHER','Other owner pool','other') returning id",[ids.a])).rows[0].id);
 await new (require('../apps/api/dist/inventory.js').InventoryController)(service).correction({actor},ids.a,{idempotency_key:key(),reason:'Other owner fixture',lines:[{item_id:item,owner_id:otherOwner,location_id:location,quantity:'20'}]});
 await new (require('../apps/api/dist/material-issues.js').MaterialIssuesController)(service).issue({actor},ids.a,order.id,{idempotency_key:key(),item_id:item,owner_id:otherOwner,from_location_id:location,to_location_id:target,quantity:'6',comment:'Other owner issue'});
 let r=await get({production_order_ids:[order.id]});expect(r.physical).toBe('90.00000001');expect(r.in_production).toBe('0');expect(r.remaining_demand).toBe('0');
 r=await get({owner_id:otherOwner});expect(r.physical).toBe('20');expect(r.in_production).toBe('6');expect(r.projected_available).toBe('14');
});
it('loads scoped choices, refuses unknown query fields and protects all HTTP routes and revoked sessions',async()=>{
 const r=await forecast.options({actor},ids.a,{item_id:item,owner_id:owner});expect(r.orders.map((o:any)=>o.id)).toContain(order.id);expect(r.items.some((i:any)=>i.id===item)).toBe(true);
 await expect(async()=>forecast.options({actor},ids.a,{sql:'x'})).rejects.toBeDefined();
 await db.query('delete from auth.sessions where id=$1',[ids.session]);await expect(get()).rejects.toBeDefined();await db.query('insert into auth.sessions values($1,$2)',[ids.session,ids.adminA]);
 const {createApp}=require('../apps/api/dist/app.js'),{loadConfig}=require('../apps/api/dist/config.js');const app=await createApp(loadConfig({NODE_ENV:'test'}),service);await app.listen(0,'127.0.0.1');try{for(const [path,method] of [['/options','GET'],['/preview','POST']])expect((await fetch((await app.getUrl())+'/api/companies/'+ids.a+'/forecast'+path,{method})).status).toBe(401);}finally{await app.close();}
});
it('refuses stale order selections and never silently truncates a planning basis',async()=>{
 order=await prod().status({actor},ids.a,order.id,{version:order.version,status:'reconciliation'});
 await expect(get({production_order_ids:[order.id]})).rejects.toMatchObject({status:400});
 const controller=new ForecastController({asActor:async(_a:any,_c:any,work:any)=>work({query:async(sql:string)=>({rows:sql.includes('bool_and')?[{ok:true}]:sql.includes('stock_owners')?Array.from({length:201},(_,i)=>({id:String(i)})):[]})})});
 await expect(controller.options({actor},ids.a,{})).rejects.toMatchObject({status:413});
});
