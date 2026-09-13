import {it,expect,beforeAll,afterAll,describe} from 'vitest';
import {Pool} from 'pg';
import {randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
import {seedDatabase,ids} from './helpers/access-fixture';
const require=createRequire(import.meta.url);
const {InventoryController}=require('../apps/api/dist/inventory.js');
const {TransfersController}=require('../apps/api/dist/transfers.js');
const {ReceivingController}=require('../apps/api/dist/receiving.js');
const {DatabaseService}=require('../apps/api/dist/database.js');
const url=process.env.INVENTORY_TEST_DATABASE_URL;
// Deliberately excluded from hosted execution: new empty local test database only.
describe.skipIf(!url)('real PostgreSQL concurrent inventory commands',()=>{
 let pool:Pool,runtime:Pool,service:any,controller:any,item:string,owner:string,location:string;
 const actor={userId:ids.adminA,sessionId:ids.session};
 let barrier:(()=>Promise<void>)|undefined;
 function synchronize(){let remaining=2;let release!:()=>void;const ready=new Promise<void>(r=>release=r);barrier=async()=>{if(--remaining===0)release();await ready;};}
 beforeAll(async()=>{
  const u=new URL(url!);if(u.search||!['postgres:','postgresql:'].includes(u.protocol)||!['localhost','127.0.0.1','[::1]'].includes(u.hostname)||u.pathname!=='/phase7_inventory_test')throw new Error('Dedicated local phase7_inventory_test database required');
  pool=new Pool({connectionString:url,max:6});
  const exists=await pool.query("select to_regnamespace('app') as schema");if(exists.rows[0].schema)throw new Error('Test database must be empty; no reset is performed');
  await seedDatabase({exec:async(sql:string)=>pool.query(sql),query:async(sql:string,p?:any[])=>pool.query(sql,p)} as any);
  runtime=new Pool({connectionString:url,max:6,options:'-c role=app_backend'});
  service=new DatabaseService({});service.pool=runtime;
  controller=new InventoryController(service);
  await service.asActor(actor,ids.a,async(db:any)=>{
   const unit=(await db.query("insert into app.units(company_id,code,name,symbol,dimension) values($1,'KG','Kilogram','kg','mass') returning id",[ids.a])).rows[0].id;
   item=(await db.query("insert into app.items(company_id,kind,code,name,unit_id) values($1,'material','M','Material',$2) returning id",[ids.a,unit])).rows[0].id;
   owner=(await db.query("insert into app.stock_owners(company_id,code,name,kind) values($1,'OWN','Company stock','company') returning id",[ids.a])).rows[0].id;
   location=(await db.query("insert into app.locations(company_id,code,name) values($1,'L','Location') returning id",[ids.a])).rows[0].id;
  });
  const original=service.asActor.bind(service);
  service.asActor=(a:any,c:string,work:any)=>original(a,c,async(db:any)=>{if(barrier)await barrier();return work(db);});
 },30000);
 afterAll(async()=>{await runtime?.end();await pool?.end();});
 const post=(quantity:string,key=randomUUID())=>controller.correction({actor},ids.a,{idempotency_key:key,reason:'Concurrent local test',lines:[{item_id:item,owner_id:owner,location_id:location,quantity}]});
 it('retries conflicting writers and posts one journal for a shared idempotency key',async()=>{
  synchronize();const key=randomUUID();const results=await Promise.all([post('500',key),post('500',key)]);expect(results[0].id).toBe(results[1].id);
  expect((await pool.query('select quantity from app.stock_balances')).rows[0].quantity).toBe('500.00000000');
  expect((await pool.query('select count(*)::int n from app.inventory_entries')).rows[0].n).toBe(1);
 });
 it('allows only one competing debit when their total exceeds physical stock',async()=>{
  synchronize();const results=await Promise.allSettled([post('-400'),post('-300')]);expect(results.filter(x=>x.status==='fulfilled')).toHaveLength(1);
  const rejected=results.find(x=>x.status==='rejected') as PromiseRejectedResult;expect(rejected.reason.code).toBe('23514');
  const q=(await pool.query('select quantity from app.stock_balances')).rows[0].quantity;expect(['100.00000000','200.00000000']).toContain(q);
  expect((await pool.query('select sum(quantity)::text quantity from app.inventory_lines')).rows[0].quantity).toBe(q);
 });
 it('concurrent receipt retries add stock exactly once and preserve the journal',async()=>{
  const receiving=new ReceivingController(service);
  const before=(await pool.query('select quantity from app.stock_balances')).rows[0].quantity;
  const body={idempotency_key:randomUUID(),item_id:item,owner_id:owner,location_id:location,quantity:'0.00825001',expected_quantity:'0.01',comment:'Local concurrency test'};
  synchronize();const results=await Promise.all([receiving.receive({actor},ids.a,body),receiving.receive({actor},ids.a,body)]);
  expect(results[0].id).toBe(results[1].id);
  expect(results[0].difference).toBe('-0.00174999');
  const delta=await pool.query('select (quantity-$1::numeric)::text delta from app.stock_balances',[before]);
  expect(delta.rows[0].delta).toBe('0.00825001');
  expect((await pool.query("select count(*)::int n from app.inventory_entries where kind='receipt'")).rows[0].n).toBe(1);
 });
 it('receipt and correction cannot share a key with different commands',async()=>{
  const receiving=new ReceivingController(service),key=randomUUID();synchronize();
  const results=await Promise.allSettled([post('1',key),receiving.receive({actor},ids.a,{idempotency_key:key,item_id:item,owner_id:owner,location_id:location,quantity:'1'})]);
  expect(results.filter(x=>x.status==='fulfilled')).toHaveLength(1);
  const rejected=results.find(x=>x.status==='rejected') as PromiseRejectedResult;expect(rejected.reason.getStatus()).toBe(409);
  expect((await pool.query('select count(*)::int n from app.inventory_entries where idempotency_key=$1',[key])).rows[0].n).toBe(1);
 });

 it('competing transfers cannot overdraw a shared source and conserve total stock',async()=>{
  barrier=undefined;
  const target=(await service.asActor(actor,ids.a,async(db:any)=>(await db.query("insert into app.locations(company_id,code,name) values($1,'DEST','Destination') returning id",[ids.a])).rows[0].id));
  const before=(await pool.query('select quantity from app.stock_balances where location_id=$1',[location])).rows[0].quantity;
  const transfer=new TransfersController(service),base={item_id:item,owner_id:owner,from_location_id:location,to_location_id:target,quantity:before};
  synchronize();const results=await Promise.allSettled([transfer.transfer({actor},ids.a,{...base,idempotency_key:randomUUID()}),transfer.transfer({actor},ids.a,{...base,idempotency_key:randomUUID()})]);
  expect(results.filter(x=>x.status==='fulfilled')).toHaveLength(1);expect((results.find(x=>x.status==='rejected') as PromiseRejectedResult).reason.code).toBe('23514');
  expect((await pool.query('select sum(quantity)::text n from app.stock_balances')).rows[0].n).toBe(before);
  expect((await pool.query('select quantity from app.stock_balances where location_id=$1',[location])).rows[0].quantity).toBe('0.00000000');
  // Reverse direction, duplicate key: only one movement is posted.
  const input={...base,idempotency_key:randomUUID(),from_location_id:target,to_location_id:location};synchronize();const duplicate=await Promise.all([transfer.transfer({actor},ids.a,input),transfer.transfer({actor},ids.a,input)]);expect(duplicate[0].id).toBe(duplicate[1].id);
  expect((await pool.query("select count(*)::int n from app.inventory_entries where kind='transfer'")).rows[0].n).toBe(2);
  expect((await pool.query('select quantity from app.stock_balances where location_id=$1',[location])).rows[0].quantity).toBe(before);
 });

 it('production order creation is idempotent and competing edits cannot lose an update',async()=>{
  barrier=undefined;
  const {ProductionOrdersController}=require('../apps/api/dist/production-orders.js');
  const production=new ProductionOrdersController(service);
  const product=await service.asActor(actor,ids.a,async(db:any)=>(await db.query("insert into app.items(company_id,kind,code,name) values($1,'product','PROD','Local product') returning id",[ids.a])).rows[0].id);
  const input={product_id:product,code:'PO-CONCURRENT',quantity:'10',idempotency_key:randomUUID()};
  synchronize();const duplicate=await Promise.all([production.create({actor},ids.a,input),production.create({actor},ids.a,input)]);
  expect(duplicate[0].id).toBe(duplicate[1].id);
  expect((await pool.query('select count(*)::int n from app.production_orders')).rows[0].n).toBe(1);
  synchronize();const edits=await Promise.allSettled([production.edit({actor},ids.a,duplicate[0].id,{version:1,data:{code:input.code,quantity:'11'}}),production.edit({actor},ids.a,duplicate[0].id,{version:1,data:{code:input.code,quantity:'12'}})]);
  expect(edits.filter(x=>x.status==='fulfilled')).toHaveLength(1);
  expect((edits.find(x=>x.status==='rejected') as PromiseRejectedResult).reason.getStatus()).toBe(409);
  expect((await pool.query('select count(*)::int n from app.production_order_audit')).rows[0].n).toBe(2);
 });

 it('material issues serialize against order edits, deduplicate and never overdraw shared stock',async()=>{
  barrier=undefined;
  const {MaterialIssuesController}=require('../apps/api/dist/material-issues.js');
  const {ProductionOrdersController}=require('../apps/api/dist/production-orders.js');
  const production=new ProductionOrdersController(service),issues=new MaterialIssuesController(service);
  const setup=await service.asActor(actor,ids.a,async(db:any)=>{
   const unit=(await db.query('select unit_id from app.items where id=$1',[item])).rows[0].unit_id;
   const product=(await db.query("insert into app.items(company_id,kind,code,name,unit_id) values($1,'product','ISSUE-P','Issue product',$2) returning id",[ids.a,unit])).rows[0].id;
   const target=(await db.query("insert into app.locations(company_id,code,name) values($1,'PRODUCTION','Production') returning id",[ids.a])).rows[0].id;
   const machine=(await db.query("insert into app.machines(company_id,code,name,location_id) values($1,'ISSUE-M','Issue machine',$2) returning id",[ids.a,target])).rows[0].id;
   const recipe=(await db.query("insert into app.recipes(company_id,product_id,kind,name) values($1,$2,'bom','Issue BOM') returning id",[ids.a,product])).rows[0].id;
   const bom=(await db.query('insert into app.recipe_revisions(company_id,recipe_id,revision) values($1,$2,1) returning id',[ids.a,recipe])).rows[0].id;
   await db.query("insert into app.recipe_lines(company_id,revision_id,component_id,kind,quantity) values($1,$2,$3,'component',1)",[ids.a,bom,item]);
   await db.query('update app.recipe_revisions set sealed=true where id=$1',[bom]);
   return {product,target,machine,bom};
  });
  const make=async(code:string)=>{const o=await production.create({actor},ids.a,{code,product_id:setup.product,machine_id:setup.machine,bom_revision_id:setup.bom,quantity:'10',idempotency_key:randomUUID()});return production.status({actor},ids.a,o.id,{status:'planned',version:o.version});};
  const order=await make('ISSUE-C1'),second=await make('ISSUE-C2');
  const body={item_id:item,owner_id:owner,from_location_id:location,to_location_id:setup.target,quantity:'1',idempotency_key:randomUUID()};
  synchronize();const duplicate=await Promise.all([issues.issue({actor},ids.a,order.id,body),issues.issue({actor},ids.a,order.id,body)]);expect(duplicate[0].id).toBe(duplicate[1].id);
  const balance=(await pool.query('select quantity from app.stock_balances where item_id=$1 and location_id=$2',[item,location])).rows[0].quantity;
  synchronize();const race=await Promise.allSettled([issues.issue({actor},ids.a,order.id,{...body,quantity:balance,idempotency_key:randomUUID()}),issues.issue({actor},ids.a,second.id,{...body,quantity:balance,idempotency_key:randomUUID()})]);expect(race.filter(r=>r.status==='fulfilled')).toHaveLength(1);
  expect((await pool.query('select min(quantity)>=0 as safe from app.stock_balances')).rows[0].safe).toBe(true);
  barrier=undefined;await post('1');const third=await make('ISSUE-C3');
  synchronize();await Promise.allSettled([issues.issue({actor},ids.a,third.id,{...body,idempotency_key:randomUUID()}),production.status({actor},ids.a,third.id,{status:'draft',version:third.version})]);
  const invariant=await pool.query("select not(status='draft' and exists(select 1 from app.inventory_entries where production_order_id=$1)) as safe from app.production_orders where id=$1",[third.id]);expect(invariant.rows[0].safe).toBe(true);
 });

 it('production increments and reversals serialize without lost totals or stock effects',async()=>{
  barrier=undefined;
  const {ProductionOrdersController}=require('../apps/api/dist/production-orders.js');
  const {ProductionRegistrationsController}=require('../apps/api/dist/production-registrations.js');
  const production=new ProductionOrdersController(service),registrations=new ProductionRegistrationsController(service);
  const setup=await service.asActor(actor,ids.a,async(db:any)=>{
   const unit=(await db.query("insert into app.units(company_id,code,name,symbol,dimension) values($1,'REG-PCS','Pieces','stk.','count') returning id",[ids.a])).rows[0].id;
   const product=(await db.query("insert into app.items(company_id,kind,code,name,unit_id) values($1,'product','REG-P','Registration product',$2) returning id",[ids.a,unit])).rows[0].id;
   const box=(await db.query("insert into app.items(company_id,kind,code,name,unit_id) values($1,'packaging','REG-B','Box',$2) returning id",[ids.a,unit])).rows[0].id;
   const machine=(await db.query("insert into app.machines(company_id,code,name) values($1,'REG-M','Machine') returning id",[ids.a])).rows[0].id;
   const revisions:any={};
   for(const kind of ['bom','packing']){
    const recipe=(await db.query('insert into app.recipes(company_id,product_id,kind,name) values($1,$2,$3,$3) returning id',[ids.a,product,kind])).rows[0].id;
    const revision=(await db.query('insert into app.recipe_revisions(company_id,recipe_id,revision) values($1,$2,1) returning id',[ids.a,recipe])).rows[0].id;
    await db.query('insert into app.recipe_lines(company_id,revision_id,component_id,kind,quantity) values($1,$2,$3,$4,1)',[ids.a,revision,kind==='bom'?item:box,kind==='bom'?'component':'container']);
    await db.query('update app.recipe_revisions set sealed=true where id=$1',[revision]);revisions[kind]=revision;
   }
   return {product,machine,...revisions};
  });
  let order=await production.create({actor},ids.a,{code:'REG-CONCURRENT',product_id:setup.product,machine_id:setup.machine,bom_revision_id:setup.bom,packing_revision_id:setup.packing,quantity:'100',idempotency_key:randomUUID()});
  for(const status of ['planned','ready','in_production'])order=await production.status({actor},ids.a,order.id,{status,version:order.version});
  const stockBefore=(await pool.query('select count(*)::int n from app.inventory_entries')).rows[0].n;
  const body={quantity:'20',idempotency_key:randomUUID()};
  synchronize();const duplicate=await Promise.all([registrations.create({actor},ids.a,order.id,body),registrations.create({actor},ids.a,order.id,body)]);expect(duplicate[0].id).toBe(duplicate[1].id);
  synchronize();await Promise.all([registrations.create({actor},ids.a,order.id,{...body,idempotency_key:randomUUID()}),registrations.create({actor},ids.a,order.id,{...body,idempotency_key:randomUUID()})]);
  barrier=undefined;expect((await registrations.summary({actor},ids.a,order.id)).good_quantity).toBe('60.00000000');
  synchronize();const reversed=await Promise.allSettled([registrations.reverse({actor},ids.a,order.id,duplicate[0].id,{idempotency_key:randomUUID(),comment:'Correction A'}),registrations.reverse({actor},ids.a,order.id,duplicate[0].id,{idempotency_key:randomUUID(),comment:'Correction B'})]);expect(reversed.filter(x=>x.status==='fulfilled')).toHaveLength(1);
  barrier=undefined;expect((await registrations.summary({actor},ids.a,order.id)).good_quantity).toBe('40.00000000');
  synchronize();const race=await Promise.allSettled([registrations.create({actor},ids.a,order.id,{...body,idempotency_key:randomUUID()}),production.problem({actor},ids.a,order.id,{version:order.version,problem:'Stop'})]);
  barrier=undefined;expect(race[1].status).toBe('fulfilled');expect((await registrations.summary({actor},ids.a,order.id)).good_quantity).toBe(race[0].status==='fulfilled'?'60.00000000':'40.00000000');
  expect((await pool.query('select count(*)::int n from app.inventory_entries')).rows[0].n).toBe(stockBefore);
 });

 it('competing returns and closure serialize without over-return or duplicate consumption',async()=>{
  barrier=undefined;
  const {ProductionOrdersController}=require('../apps/api/dist/production-orders.js');
  const {MaterialIssuesController}=require('../apps/api/dist/material-issues.js');
  const {ProductionCloseController}=require('../apps/api/dist/production-close.js');
  const production=new ProductionOrdersController(service),issues=new MaterialIssuesController(service),close=new ProductionCloseController(service);
  let order=(await pool.query("select * from app.production_orders where code='REG-CONCURRENT'")).rows[0];
  order=await production.problem({actor},ids.a,order.id,{version:order.version,problem:''});
  const target=await service.asActor(actor,ids.a,async(db:any)=>(await db.query("insert into app.locations(company_id,code,name) values($1,'CLOSE-PROD','Close production') returning id",[ids.a])).rows[0].id);
  await post('10');const issue=await issues.issue({actor},ids.a,order.id,{item_id:item,owner_id:owner,from_location_id:location,to_location_id:target,quantity:'8',idempotency_key:randomUUID()});
  const body={issue_id:issue.id,to_location_id:location,quantity:'5',comment:'Unused material',idempotency_key:randomUUID()};
  synchronize();const race=await Promise.allSettled([close.returnMaterial({actor},ids.a,order.id,body),close.returnMaterial({actor},ids.a,order.id,{...body,idempotency_key:randomUUID()})]);expect(race.filter(x=>x.status==='fulfilled')).toHaveLength(1);
  const retry={...body,quantity:'1',idempotency_key:randomUUID()};synchronize();const returns=await Promise.all([close.returnMaterial({actor},ids.a,order.id,retry),close.returnMaterial({actor},ids.a,order.id,retry)]);expect(returns[0].id).toBe(returns[1].id);
  barrier=undefined;order=await production.status({actor},ids.a,order.id,{status:'reconciliation',version:order.version});
  let review=await close.review({actor},ids.a,order.id);expect(review.materials[0].remaining_quantity).toBe('2.00000000');
  let command={idempotency_key:randomUUID(),review_token:review.review_token,rejected_quantity:'0',comment:'Confirmed consumed net',confirm_materials:true};
  synchronize();const result=await Promise.allSettled([close.complete({actor},ids.a,order.id,command),close.returnMaterial({actor},ids.a,order.id,{...body,quantity:'1',idempotency_key:randomUUID()})]);
  expect(result.filter(x=>x.status==='fulfilled')).toHaveLength(1);
  barrier=undefined;if(result[0].status==='rejected'){review=await close.review({actor},ids.a,order.id);command={...command,idempotency_key:randomUUID(),review_token:review.review_token};}
  synchronize();const duplicate=await Promise.all([close.complete({actor},ids.a,order.id,command),close.complete({actor},ids.a,order.id,command)]);expect(duplicate[0].id).toBe(duplicate[1].id);
  barrier=undefined;
  expect((await pool.query('select count(*)::int n from app.production_closures where order_id=$1',[order.id])).rows[0].n).toBe(1);
  expect((await pool.query("select count(*)::int n from app.inventory_entries where production_order_id=$1 and kind='production_consumption'",[order.id])).rows[0].n).toBe(1);
  expect((await pool.query('select quantity from app.stock_balances where item_id=$1 and location_id=$2',[item,target])).rows[0].quantity).toBe('0.00000000');
  expect((await pool.query('select status from app.production_orders where id=$1',[order.id])).rows[0].status).toBe('completed');
 });

 it('concurrent measured-waste commands deduplicate and competing reversals preserve stock and closure',async()=>{
  barrier=undefined;
  const {ProductionWasteController}=require('../apps/api/dist/production-waste.js');const waste=new ProductionWasteController(service);
  const order=(await pool.query("select * from app.production_orders where code='REG-CONCURRENT'")).rows[0];
  const issue=(await pool.query("select id from app.inventory_entries where production_order_id=$1 and kind='transfer' and production_return_of is null",[order.id])).rows[0];
  const before=(await pool.query('select * from app.stock_balances order by company_id,item_id,owner_id,location_id')).rows;
  const closure=(await pool.query('select snapshot from app.production_closures where order_id=$1',[order.id])).rows[0].snapshot;
  const body={idempotency_key:randomUUID(),issue_id:issue.id,quantity:'0.125',comment:'Measured after reconciliation'};
  synchronize();const records=await Promise.all([waste.record({actor},ids.a,order.id,body),waste.record({actor},ids.a,order.id,body)]);expect(records[0].id).toBe(records[1].id);
  synchronize();const reversed=await Promise.allSettled([waste.reverse({actor},ids.a,order.id,records[0].id,{idempotency_key:randomUUID(),comment:'Measurement correction A'}),waste.reverse({actor},ids.a,order.id,records[0].id,{idempotency_key:randomUUID(),comment:'Measurement correction B'})]);expect(reversed.filter(x=>x.status==='fulfilled')).toHaveLength(1);
  barrier=undefined;expect((await pool.query('select count(*)::int n from app.production_waste where order_id=$1',[order.id])).rows[0].n).toBe(2);
  expect((await pool.query('select * from app.stock_balances order by company_id,item_id,owner_id,location_id')).rows).toEqual(before);
  expect((await pool.query('select snapshot from app.production_closures where order_id=$1',[order.id])).rows[0].snapshot).toEqual(closure);
 });

 it('deduplicates output, prevents competing overdelivery and serializes pallet moves/reversals',async()=>{
  barrier=undefined;
  const {FinishedGoodsController,HandlingUnitsController}=require('../apps/api/dist/finished-goods.js');const output=new FinishedGoodsController(service),units=new HandlingUnitsController(service);
  const order=(await pool.query("select * from app.production_orders where code='REG-CONCURRENT'")).rows[0];
  const closure=(await pool.query('select snapshot from app.production_closures where order_id=$1',[order.id])).rows[0].snapshot;
  const pallet=await service.asActor(actor,ids.a,async(db:any)=>(await db.query("insert into app.pallet_types(company_id,code,name) values($1,'OUTPUT-P','Output pallet') returning id",[ids.a])).rows[0].id);
  const body={idempotency_key:randomUUID(),quantity:'10',owner_id:owner,location_id:location,pallet_type_id:pallet,production_date:'2026-09-01',comment:'Output concurrency'};
  synchronize();const duplicate=await Promise.all([output.create({actor},ids.a,order.id,body),output.create({actor},ids.a,order.id,body)]);expect(duplicate[0].id).toBe(duplicate[1].id);
  synchronize();const race=await Promise.allSettled([output.create({actor},ids.a,order.id,{...body,idempotency_key:randomUUID(),quantity:'30',pallet_type_id:null}),output.create({actor},ids.a,order.id,{...body,idempotency_key:randomUUID(),quantity:'30',pallet_type_id:null})]);expect(race.filter(x=>x.status==='fulfilled')).toHaveLength(1);
  barrier=undefined;const hu=(await pool.query('select * from app.handling_units where delivery_id=$1',[duplicate[0].id])).rows[0];
  const target=(await pool.query("select id from app.locations where code='CLOSE-PROD'")).rows[0].id;
  const move={idempotency_key:randomUUID(),to_location_id:target,comment:'Atomic pallet move'};
  synchronize();const moves=await Promise.all([units.move({actor},ids.a,hu.id,move),units.move({actor},ids.a,hu.id,move)]);expect(moves[0].id).toBe(moves[1].id);
  barrier=undefined;await units.move({actor},ids.a,hu.id,{...move,idempotency_key:randomUUID(),to_location_id:location});
  synchronize();const reversed=await Promise.allSettled([output.reverse({actor},ids.a,order.id,duplicate[0].id,{idempotency_key:randomUUID(),comment:'Output correction A'}),output.reverse({actor},ids.a,order.id,duplicate[0].id,{idempotency_key:randomUUID(),comment:'Output correction B'})]);expect(reversed.filter(x=>x.status==='fulfilled')).toHaveLength(1);
  barrier=undefined;expect((await output.summary({actor},ids.a,order.id)).delivered_quantity).toBe('30.00000000');
  expect((await pool.query('select snapshot from app.production_closures where order_id=$1',[order.id])).rows[0].snapshot).toEqual(closure);
 });

});
