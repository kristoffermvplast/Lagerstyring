import {createRequire} from 'node:module';
import {beforeAll,afterAll,it,expect} from 'vitest';
import {fixture,ids,asUser} from './helpers/access-fixture';
const require=createRequire(import.meta.url),{DashboardController,copenhagenDay}=require('../apps/api/dist/dashboard.js');
let db:Awaited<ReturnType<typeof fixture>>,controller:any,service:any,item:string,owner:string,location:string;
const actor={userId:ids.adminA,sessionId:ids.session},reader={userId:ids.reader,sessionId:ids.sessionRead};
const admin=<T>(work:()=>Promise<T>)=>asUser(db,ids.adminA,ids.a,work);
const get=(a=actor,c=ids.a)=>controller.get({actor:a},c);
const move=(quantity:string)=>admin(()=>db.query("insert into app.inventory_entries(company_id,idempotency_key,kind,reason,request) values($1,$2,'correction','Dashboard fixture',$3)",[ids.a,crypto.randomUUID(),JSON.stringify([{item_id:item,owner_id:owner,location_id:location,quantity}])]));
const grant=async(...codes:string[])=>{for(const code of codes)await db.query('insert into app.role_permissions values($1,$2,$3) on conflict do nothing',[ids.a,ids.readRole,code]);};
const ack=(a:any,who=actor)=>controller.acknowledge({actor:who},ids.a,{key:a.key,fingerprint:a.fingerprint});
beforeAll(async()=>{
 db=await fixture();const {DatabaseService}=require('../apps/api/dist/database.js'),{loadConfig}=require('../apps/api/dist/config.js');
 service=new DatabaseService(loadConfig({NODE_ENV:'test'}));service.pool={connect:async()=>({query:async(sql:string,values?:unknown[])=>{if(sql.startsWith('BEGIN')){await db.exec('BEGIN; SET LOCAL ROLE app_backend;');return{rows:[]};}const r=await db.query(sql,values);return{rows:r.rows};},release:()=>{}})};controller=new DashboardController(service);
 await admin(async()=>{
 const unit=(await db.query<any>("insert into app.units(company_id,code,name,symbol,dimension) values($1,'KG','Kilogram','kg','mass') returning id",[ids.a])).rows[0].id;
 item=(await db.query<any>("insert into app.items(company_id,kind,code,name,unit_id,minimum_stock) values($1,'material','DASH','Dashboard material',$2,'10.00000001') returning id",[ids.a,unit])).rows[0].id;
 owner=(await db.query<any>("insert into app.stock_owners(company_id,code,name,kind) values($1,'OWN','Owner','company') returning id",[ids.a])).rows[0].id;
 location=(await db.query<any>("insert into app.locations(company_id,code,name) values($1,'L','Location') returning id",[ids.a])).rows[0].id;
 });await move('10');
});
afterAll(async()=>{await db?.close();});
it('returns scoped exact-decimal low-stock signal with direct action',async()=>{
 const v=await get();expect(v.company_id).toBe(ids.a);expect(v.limited).toEqual([]);expect(v.alerts).toHaveLength(1);expect(v.alerts[0]).toMatchObject({key:'stock-low:'+item,state:'open',target:{page:'Lager',q:'DASH'}});expect(v.alerts[0].detail).toContain('10.00000001');
 const b=await get({userId:ids.adminB,sessionId:ids.sessionB},ids.b);expect(b.alerts).toEqual([]);expect(JSON.stringify(b)).not.toContain('Dashboard material');
 await expect(get(actor,ids.b)).rejects.toMatchObject({status:403});await expect(get(actor,'invalid')).rejects.toMatchObject({status:400});
});
it('acknowledges idempotently per user, reopens changed signals and derives resolution',async()=>{
 const a=(await get()).alerts[0];await ack(a);await ack(a);expect((await get()).alerts[0].state).toBe('acknowledged');
 expect((await db.query<any>('select count(*)::int n from app.alert_acknowledgements')).rows[0].n).toBe(1);
 await move('-1');const changed=(await get()).alerts[0];expect(changed.state).toBe('open');expect(changed.fingerprint).not.toBe(a.fingerprint);await expect(ack(a)).rejects.toMatchObject({status:409});await ack(changed);
 await move('2');expect((await get()).alerts[0]).toMatchObject({state:'resolved',target:{page:'Lager',q:'DASH'}});await expect(ack(changed)).rejects.toMatchObject({status:409});
});
it('requires dashboard and source permissions; historical records stay personal',async()=>{
 await expect(get(reader)).rejects.toMatchObject({status:403});await grant('dashboard.read');expect((await get(reader)).alerts).toEqual([]);expect((await get(reader)).orders).toEqual([]);
 await grant('inventory.read','masterdata.read');await move('-2');const a=(await get(reader)).alerts[0];expect(a.state).toBe('open');await expect(ack(a,reader)).rejects.toMatchObject({status:403});
 await grant('dashboard.acknowledge');await ack(a,reader);expect((await get(reader)).alerts[0].state).toBe('acknowledged');expect((await get()).alerts[0].state).toBe('open');
 await db.query("delete from app.role_permissions where role_id=$1 and permission_code='masterdata.read'",[ids.readRole]);expect((await get(reader)).alerts).toEqual([]);await move('2');expect((await get(reader)).alerts).toEqual([]);
});
it('rejects forged payloads and protects immutable acknowledgement identity and browser grants',async()=>{
 for(const input of [{key:'x',fingerprint:'bad'},{key:'x',fingerprint:'a'.repeat(64),actor_id:ids.reader}])expect(()=>controller.acknowledge({actor},ids.a,input)).toThrow();
 await expect(ack({key:'stock-low:'+ids.b,fingerprint:'a'.repeat(64)})).rejects.toMatchObject({status:409});
 for(const sql of ['update app.alert_acknowledgements set actor_id=actor_id','delete from app.alert_acknowledgements'])await expect(admin(()=>db.exec(sql))).rejects.toBeDefined();
 await expect(admin(()=>db.query('insert into app.alert_acknowledgements(company_id,actor_id,alert_key,fingerprint) values($1,$2,$3,$4)',[ids.a,ids.reader,'x','a'.repeat(64)]))).rejects.toBeDefined();
 const p=(await db.query<any>("select has_table_privilege('anon','app.alert_acknowledgements','SELECT') a,has_table_privilege('authenticated','app.alert_acknowledgements','INSERT') b")).rows[0];expect(p).toEqual({a:false,b:false});
});
it('uses Copenhagen calendar across midnight and DST',()=>{
 expect(copenhagenDay(new Date('2026-03-28T23:30:00Z'))).toBe('2026-03-29');expect(copenhagenDay(new Date('2026-03-29T22:30:00Z'))).toBe('2026-03-30');expect(copenhagenDay(new Date('2026-10-25T22:30:00Z'))).toBe('2026-10-25');
});
it('denies revoked sessions',async()=>{await db.query('delete from auth.sessions where id=$1',[ids.session]);await expect(get()).rejects.toBeDefined();await db.query('insert into auth.sessions values($1,$2)',[ids.session,ids.adminA]);});
it('combines production problems, lateness, missing setup and sequential snapshot shortages',async()=>{
 const {ProductionOrdersController}=require('../apps/api/dist/production-orders.js'),production=new ProductionOrdersController(service);
 const {product,bom}=await admin(async()=>{
 const u=(await db.query<any>("insert into app.units(company_id,code,name,symbol,dimension) values($1,'PC','Piece','pcs','count') returning id",[ids.a])).rows[0].id;
 const p=(await db.query<any>("insert into app.items(company_id,kind,code,name,unit_id) values($1,'product','DP','Dashboard product',$2) returning id",[ids.a,u])).rows[0].id;
 const r=(await db.query<any>("insert into app.recipes(company_id,product_id,kind,name) values($1,$2,'bom','Dashboard BOM') returning id",[ids.a,p])).rows[0].id;
 const v=(await db.query<any>('insert into app.recipe_revisions(company_id,recipe_id,revision) values($1,$2,1) returning id',[ids.a,r])).rows[0].id;
 await db.query("insert into app.recipe_lines(company_id,revision_id,component_id,kind,quantity) values($1,$2,$3,'component','8')",[ids.a,v,item]);await db.query('update app.recipe_revisions set sealed=true where id=$1',[v]);return{product:p,bom:v};
 });
 const orders=[];for(const code of ['D1','D2']){
 const o=await production.create({actor},ids.a,{idempotency_key:crypto.randomUUID(),product_id:product,code,quantity:'1',bom_revision_id:bom,deadline:'2020-01-01T12:00:00Z'});
 await admin(()=>db.query("update app.production_orders set status='planned',problem='Afklar maskinstop',version=version+1 where id=$1",[o.id]));orders.push(o);
 }
 const v=await get();expect(v.orders).toHaveLength(2);expect(v.orders[0]).not.toHaveProperty('snapshot');
 expect(v.alerts.filter((a:any)=>a.key.startsWith('order-late:'))).toHaveLength(2);expect(v.alerts.filter((a:any)=>a.key.startsWith('order-problem:'))).toHaveLength(2);expect(v.alerts.filter((a:any)=>a.key.startsWith('order-setup:'))).toHaveLength(2);
 const shortage=v.alerts.filter((a:any)=>a.key.startsWith('shortage:'));expect(shortage).toHaveLength(1);expect(shortage[0].detail).toContain('beregnet mangel 5.');expect(shortage[0].target.page).toBe('Produktion');
});
it('ignores external-owned stock and subtracts active reservations',async()=>{
 await admin(async()=>{
 const external=(await db.query<any>("insert into app.stock_owners(company_id,code,name,kind) values($1,'EXT','External owner','other') returning id",[ids.a])).rows[0].id;
 await db.query("insert into app.inventory_entries(company_id,idempotency_key,kind,reason,request) values($1,$2,'correction','External stock',$3)",[ids.a,crypto.randomUUID(),JSON.stringify([{item_id:item,owner_id:external,location_id:location,quantity:'1000'}])]);
 const k=crypto.randomUUID();await db.query("insert into app.reservation_events(company_id,idempotency_key,kind,reservation_id,reason,request) values($1,$2,'reserve',$2,'Reserved stock',$3)",[ids.a,k,JSON.stringify({item_id:item,owner_id:owner,location_id:location,handling_unit_id:null,quantity:'2',reference:'Reserve dashboard'})]);
 });
 const a=(await get()).alerts.find((a:any)=>a.key==='stock-low:'+item);expect(a.detail).toContain('9.00000000 disponibelt');
});
it('shows stale counts and late shipments with exact source IDs',async()=>{
 const {StockCountsController}=require('../apps/api/dist/stock-counts.js'),counts=new StockCountsController(service);
 const c=await counts.start({actor},ids.a,{idempotency_key:crypto.randomUUID(),reason:'Dashboard count',item_id:item,owner_id:owner,location_id:location});await move('1');
 const customer=await admin(async()=>(await db.query<any>("insert into app.customers(company_id,code,name) values($1,'DC','Dashboard customer') returning id",[ids.a])).rows[0].id);
 const {ShipmentsController}=require('../apps/api/dist/shipments.js'),shipments=new ShipmentsController(service);
 const create=(date:string)=>shipments.create({actor},ids.a,{idempotency_key:crypto.randomUUID(),version:0,reason:'Dashboard shipment',data:{code:crypto.randomUUID(),customer_id:customer,ship_date:date,lines:[{item_id:item,owner_id:owner,location_id:location,quantity:'1'}]}});
 const late=await create('2020-01-01'),today=await create(copenhagenDay(new Date()));const v=await get();
 expect(v.alerts.find((a:any)=>a.key==='count-stale:'+c.id)).toMatchObject({severity:'critical',target:{page:'Optælling',id:c.id}});
 expect(v.alerts.find((a:any)=>a.key==='shipment-late:'+late.id)).toMatchObject({severity:'critical',target:{page:'Forsendelser',id:late.id}});expect(v.shipments.map((s:any)=>s.id)).toEqual([today.id]);
});
it('marks bounded source lists partial and never infers resolution from truncation',async()=>{
 await admin(async()=>{const u=(await db.query<any>("select unit_id from app.items where id=$1",[item])).rows[0].unit_id;
 await db.query("insert into app.items(company_id,kind,code,name,unit_id) select $1,'material','ZZ'||n,'Bounded item '||n,$2 from generate_series(1,201) n",[ids.a,u]);});
 const v=await get();expect(v.limited).toContain('Lager');expect(v.alerts.some((a:any)=>a.state==='resolved')).toBe(false);
});

it('registers both routes behind HTTP authentication',async()=>{
 const {createApp}=require('../apps/api/dist/app.js'),{loadConfig}=require('../apps/api/dist/config.js');const app=await createApp(loadConfig({NODE_ENV:'test'}),service);await app.listen(0,'127.0.0.1');
 try{for(const [suffix,method] of [['','GET'],['/acknowledge','POST']])expect((await fetch((await app.getUrl())+'/api/companies/'+ids.a+'/dashboard'+suffix,{method})).status).toBe(401);}finally{await app.close();}
});
