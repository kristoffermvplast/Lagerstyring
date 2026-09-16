import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {beforeAll,afterAll,it,expect} from 'vitest';
import {fixture,ids,asUser} from './helpers/access-fixture';
const require=createRequire(import.meta.url),{ReportsController,csvCell,reportKinds}=require('../apps/api/dist/reports.js');
let db:Awaited<ReturnType<typeof fixture>>,service:any,reports:any,item:string,unit:string,pcs:string,owner:string,location:string,target:string,box:string,product:string,machine:string,bom:string,packing:string,order:any,issue:any;
const actor={userId:ids.adminA,sessionId:ids.session},reader={userId:ids.reader,sessionId:ids.sessionRead},key=()=>crypto.randomUUID();
const admin=<T>(work:()=>Promise<T>)=>asUser(db,ids.adminA,ids.a,work);
const get=(kind='inventory',q:object={},a=actor,c=ids.a)=>reports.list({actor:a},c,kind,q);
const grant=async(...codes:string[])=>{for(const code of codes)await db.query('insert into app.role_permissions values($1,$2,$3) on conflict do nothing',[ids.a,ids.readRole,code]);};
const correction=(quantity:string,i=item)=>new (require('../apps/api/dist/inventory.js').InventoryController)(service).correction({actor},ids.a,{idempotency_key:key(),reason:'Report fixture',reference:'REF',lines:[{item_id:i,owner_id:owner,location_id:location,quantity}]});
beforeAll(async()=>{
 db=await fixture();const {DatabaseService}=require('../apps/api/dist/database.js'),{loadConfig}=require('../apps/api/dist/config.js');service=new DatabaseService(loadConfig({NODE_ENV:'test'}));service.pool={connect:async()=>({query:async(sql:string,values?:unknown[])=>{if(sql.startsWith('BEGIN')){await db.exec('BEGIN; SET LOCAL ROLE app_backend;');return{rows:[]};}const r=await db.query(sql,values);return{rows:r.rows};},release:()=>{}})};reports=new ReportsController(service);
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
it('reconciles exact stock totals with signed journal and never combines unlike units',async()=>{
 const stock=await get('stock'),journal=await get();expect(stock.company_id).toBe(ids.a);expect(stock.totals).toHaveLength(2);expect(journal.totals).toEqual(stock.totals.map((t:any)=>({...t,available_quantity:'0',reserved_quantity:'0'})));
 expect(stock.totals.find((t:any)=>t.unit_id===unit).quantity).toBe('100.00000001');expect(stock.items[0].quantity).toEqual(expect.any(String));
 const first=await get('inventory',{limit:1}),second=await get('inventory',{limit:1,page:2});expect(first.total).toBe(2);expect(first.totals).toEqual(second.totals);expect(first.items[0].row_id).not.toBe(second.items[0].row_id);expect(first.items[0].entry_id).toBeTruthy();
});
it('preserves historical names, literal search, reversals and physical versus reserved quantities',async()=>{
 const entry=await correction('1');await admin(()=>db.query("update app.items set name='Current name',version=version+1 where id=$1",[item]));
 await new (require('../apps/api/dist/inventory.js').InventoryController)(service).reverse({actor},ids.a,entry.id,{idempotency_key:key(),reason:'Reverse reporting test'});
 const journal=await get('inventory',{q:'%_'});expect(journal.total).toBe(3);expect(journal.items.some((r:any)=>r.quantity==='-1.00000000'&&r.reverses_id===entry.id)).toBe(true);expect(journal.items.filter((r:any)=>!r.reverses_id).every((r:any)=>r.name==='Historical material')).toBe(true);expect(journal.totals[0].quantity).toBe('100.00000001');
 await admin(async()=>{const k=key();await db.query("insert into app.reservation_events(company_id,idempotency_key,kind,reservation_id,reason,request) values($1,$2,'reserve',$2,'Report reservation',$3)",[ids.a,k,JSON.stringify({item_id:item,owner_id:owner,location_id:location,handling_unit_id:null,quantity:'5',reference:'Reserved'})]);});
 const stock=await get('stock',{item_id:item});expect(stock.totals[0]).toMatchObject({quantity:'100.00000001',reserved_quantity:'5.00000000',available_quantity:'95.00000001'});expect((await get('inventory',{item_id:item})).totals[0].quantity).toBe(stock.totals[0].quantity);
});
it('enforces report/source/export permissions, tenant filters and personal immutable history',async()=>{
 await expect(get('inventory',{},reader)).rejects.toMatchObject({status:403});await grant('reports.read');await expect(get('inventory',{},reader)).rejects.toMatchObject({status:403});await grant('inventory.read');expect((await get('inventory',{},reader)).total).toBeGreaterThan(0);
 await expect(reports.export({actor:reader},ids.a,'inventory',{})).rejects.toMatchObject({status:403});await grant('reports.export');await expect(get('production',{},reader)).rejects.toMatchObject({status:403});
 await expect(get('stock',{},actor,ids.b)).rejects.toMatchObject({status:403});expect((await get('stock',{}, {userId:ids.adminB,sessionId:ids.sessionB},ids.b)).total).toBe(0);expect((await get('stock',{item_id:ids.b})).total).toBe(0);
 await reports.export({actor},ids.a,'stock',{});expect((await reports.history({actor:reader},ids.a,{})).items).toEqual([]);
 for(const sql of ['update app.report_exports set row_count=0','delete from app.report_exports'])await expect(admin(()=>db.exec(sql))).rejects.toBeDefined();
 const p=(await db.query<any>("select has_table_privilege('anon','app.report_exports','SELECT') a,has_table_privilege('authenticated','app.report_exports','INSERT') b,has_column_privilege('app_runtime','app.report_exports','actor_id','INSERT') c")).rows[0];expect(p).toEqual({a:false,b:false,c:false});
});
it('exports every filtered row instead of a page, preserving decimals and a verifiable generation receipt',async()=>{
 const list=await get('inventory',{limit:1,item_id:item}),x=await reports.export({actor},ids.a,'inventory',{item_id:item});expect(x.row_count).toBe(list.total);expect(x.row_count).toBeGreaterThan(list.items.length);expect(x.totals).toEqual(list.totals);expect(x.csv).toContain('100.00000001');expect(x.sha256).toBe(createHash('sha256').update(x.csv,'utf8').digest('hex'));
 const history=await reports.history({actor},ids.a,{});expect(history.items[0]).toMatchObject({id:x.receipt.id,sha256:x.sha256,row_count:x.row_count,filters:{item_id:item,q:''}});
});
it('protects CSV text from formulas and escapes semicolons, quotes and newlines without corrupting signed amounts',()=>{
 for(const value of ['=1+1','+cmd','-cmd','@SUM(A1)',' \t=1','\n=1'])expect(csvCell(value)).toBe('"\''+value+'"');expect(csvCell('a;"b\nc')).toBe('"a;""b\nc"');expect(csvCell('-0.00000001',true)).toBe('"-0.00000001"');expect(()=>csvCell('=1',true)).toThrow();
});
it('validates report names, strict filters, UUIDs and unsupported stock periods',async()=>{
 expect(()=>get('unknown')).toThrow();for(const q of [{from:'0000-01-01'},{from:'2026-02-30'},{page:0},{limit:101},{item_id:'x'},{sql:'drop table'},{from:'2026-01-01T00:00:00Z'}])expect(()=>get('inventory',q)).toThrow();
 await expect(get('inventory',{from:'2026-02-01',to:'2026-01-01'})).rejects.toMatchObject({status:400});await expect(get('stock',{from:'2026-01-01'})).rejects.toMatchObject({status:400});await expect(get('production',{owner_id:owner})).rejects.toMatchObject({status:400});expect(()=>reports.export({actor},ids.a,'stock',{page:1})).toThrow();
});
it('filters Copenhagen days across the DST boundary using inclusive dates and excludes adjacent instants',async()=>{
 // Isolated fixture-only time shaping; never run against a hosted database.
 const x=await correction('2'),y=await correction('3'),z=await correction('4');
 await db.exec('alter table app.inventory_entries disable trigger user');
 try{for(const [id,t] of [[x.id,'2026-03-28T23:00:00Z'],[y.id,'2026-03-29T21:59:59Z'],[z.id,'2026-03-29T22:00:00Z']])await db.query('update app.inventory_entries set posted_at=$2 where id=$1',[id,t]);}finally{await db.exec('alter table app.inventory_entries enable trigger user');}
 const v=await get('inventory',{from:'2026-03-29',to:'2026-03-29'});expect(v.total).toBe(2);expect(v.totals[0].quantity).toBe('5.00000000');expect(v.items.map((r:any)=>r.entry_id).sort()).toEqual([x.id,y.id].sort());
});
it('reports production and measured waste net of reversals with traceable original IDs',async()=>{
 const production=new (require('../apps/api/dist/production-orders.js').ProductionOrdersController)(service);
 order=await production.create({actor},ids.a,{idempotency_key:key(),product_id:product,code:'REPORT-ORDER',quantity:'10',machine_id:machine,bom_revision_id:bom,packing_revision_id:packing});
 for(const status of ['planned','ready','in_production'])order=await production.status({actor},ids.a,order.id,{version:order.version,status});
 issue=await new (require('../apps/api/dist/material-issues.js').MaterialIssuesController)(service).issue({actor},ids.a,order.id,{idempotency_key:key(),item_id:item,owner_id:owner,from_location_id:location,to_location_id:target,quantity:'8.00000001',comment:'Report issue'});
 const registrations=new (require('../apps/api/dist/production-registrations.js').ProductionRegistrationsController)(service);await registrations.create({actor},ids.a,order.id,{idempotency_key:key(),quantity:'10'});const extra=await registrations.create({actor},ids.a,order.id,{idempotency_key:key(),quantity:'2'});await registrations.reverse({actor},ids.a,order.id,extra.id,{idempotency_key:key(),comment:'Wrong extra'});
 const waste=new (require('../apps/api/dist/production-waste.js').ProductionWasteController)(service);const w=await waste.record({actor},ids.a,order.id,{idempotency_key:key(),issue_id:issue.id,quantity:'1.00000001',comment:'Measured waste'});await waste.reverse({actor},ids.a,order.id,w.id,{idempotency_key:key(),comment:'Wrong observation'});await waste.record({actor},ids.a,order.id,{idempotency_key:key(),issue_id:issue.id,quantity:'0.5',comment:'Correct observation'});
 const p=await get('production',{order_id:order.id}),v=await get('waste',{location_id:target});expect(p.total).toBe(3);expect(p.totals[0].quantity).toBe('10.00000000');expect(p.items.some((r:any)=>r.reverses_id===extra.id)).toBe(true);expect(v.total).toBe(3);expect(v.totals[0].quantity).toBe('0.50000000');expect(v.items.every((r:any)=>r.entry_id===issue.id&&r.order_id===order.id)).toBe(true);expect((await get('consumption')).total).toBe(0);
});
it('reports consumption only after closure, not material issue or waste observation',async()=>{
 const close=new (require('../apps/api/dist/production-close.js').ProductionCloseController)(service),production=new (require('../apps/api/dist/production-orders.js').ProductionOrdersController)(service);
 order=await production.status({actor},ids.a,order.id,{version:order.version,status:'reconciliation'});await close.returnMaterial({actor},ids.a,order.id,{idempotency_key:key(),issue_id:issue.id,to_location_id:location,quantity:'2',comment:'Return unused'});const review=await close.review({actor},ids.a,order.id);await close.complete({actor},ids.a,order.id,{idempotency_key:key(),review_token:review.review_token,rejected_quantity:'0',comment:'Reviewed reporting closure',confirm_materials:true});
 const v=await get('consumption',{order_id:order.id});expect(v.total).toBe(1);expect(v.totals[0].quantity).toBe('6.00000001');const line=(await db.query<any>('select quantity from app.inventory_lines where id=$1',[v.items[0].row_id])).rows[0];expect(line.quantity).toBe('-6.00000001');expect(v.items[0].entry_id).toBe(v.items[0].source_id);
});
it('reports dispatched quantities from the journal and excludes planned shipments',async()=>{
 const customer=await admin(async()=>(await db.query<any>("insert into app.customers(company_id,code,name) values($1,'RC','Customer') returning id",[ids.a])).rows[0].id);
 const shipments=new (require('../apps/api/dist/shipments.js').ShipmentsController)(service);let s=await shipments.create({actor},ids.a,{idempotency_key:key(),version:0,reason:'Report shipment',data:{code:'RS',customer_id:customer,ship_date:'2026-09-16',lines:[{item_id:item,owner_id:owner,location_id:location,quantity:'2.00000001'}]}});
 for(const action of ['plan','reserve','ready'])s=await shipments.transition({actor},ids.a,s.id,action,{idempotency_key:key(),version:s.version,reason:'Report shipment stage'});expect((await get('shipments')).total).toBe(0);
 s=await shipments.transition({actor},ids.a,s.id,'dispatch',{idempotency_key:key(),version:s.version,reason:'Actual dispatch'});const v=await get('shipments');expect(v.totals[0].quantity).toBe('2.00000001');expect(v.items[0]).toMatchObject({source_id:s.id,entry_id:s.entry_id,reference:'RS'});
});
it('denies revoked sessions and registers HTTP routes behind auth',async()=>{
 await db.query('delete from auth.sessions where id=$1',[ids.session]);await expect(get()).rejects.toBeDefined();await db.query('insert into auth.sessions values($1,$2)',[ids.session,ids.adminA]);
 const {createApp}=require('../apps/api/dist/app.js'),{loadConfig}=require('../apps/api/dist/config.js');const app=await createApp(loadConfig({NODE_ENV:'test'}),service);await app.listen(0,'127.0.0.1');try{for(const [path,method] of [['/stock','GET'],['/stock/export','POST'],['/exports','GET']])expect((await fetch((await app.getUrl())+'/api/companies/'+ids.a+'/reports'+path,{method})).status).toBe(401);}finally{await app.close();}
});
it('refuses oversized exports before generating any audit receipt',async()=>{
 // Lightweight boundary double exercises the actual export guard without 2001 journal writes.
 const controller=new ReportsController({asActor:async(_a:any,_c:any,work:any)=>work({query:async(sql:string)=>{if(sql.includes('bool_and'))return{rows:[{ok:true}]};if(sql.startsWith('set '))return{rows:[]};if(sql.includes('count(*)'))return{rows:[{total:2001}]};throw new Error('Should stop before export reads or receipt insertion');}})});
 await expect(controller.export({actor},ids.a,'inventory',{})).rejects.toMatchObject({status:413});
});
