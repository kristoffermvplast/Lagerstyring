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

});
