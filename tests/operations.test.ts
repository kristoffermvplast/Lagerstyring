import {beforeAll,afterAll,it,expect} from 'vitest';
import {createRequire} from 'node:module';
import {createServer,Server} from 'node:http';
import {AddressInfo} from 'node:net';
import {createHash,randomUUID} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {Pool} from 'pg';
import {fixture,seedDatabase,ids} from './helpers/access-fixture';
const require=createRequire(import.meta.url);
const {createApp}=require('../apps/api/dist/app.js');
const {DatabaseService}=require('../apps/api/dist/database.js');
const {loadConfig}=require('../apps/api/dist/config.js');
const url=process.env.PHASE26_TEST_DATABASE_URL;
let db:any,runtime:Pool|undefined,service:any,app:any,provider:Server,origin:string,issuer:string;
let bearer:string,other:string,reader:string,item:string,owner:string,location:string,target:string,customer:string,shipment:any;
const accepted=new Map<string,string>();
const key=()=>randomUUID();
const base=(company=ids.a)=>`/companies/${company}`;
function token(user:string,session:string){
 const value=Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url')+'.'+Buffer.from(JSON.stringify({sub:user,session_id:session,iss:issuer,role:'authenticated',aud:'authenticated',exp:Math.floor(Date.now()/1000)+1800})).toString('base64url')+'.local-fixture';
 accepted.set(value,user);return value;
}
async function call(path:string,method='GET',body?:unknown,auth=bearer){
 return fetch(origin+'/api'+path,{method,headers:{Authorization:'Bearer '+auth,'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(15000)});
}
async function ok(path:string,method='GET',body?:unknown,status=200){const r=await call(path,method,body);expect(r.status,`${method} ${path}`).toBe(status);return r.json();}
async function importRows(kind:string,csv:string){const p=await ok(base()+`/imports/${kind}/preview`,'POST',{filename:'operations.csv',csv},201);expect(p.errors).toEqual([]);return ok(base()+`/imports/${kind}/${p.job_id}/confirm`,'POST',{confirm:true},201);}
async function snapshot(database=db){
 const names=(await database.query("select schemaname,tablename from pg_tables where schemaname in ('app','app_private','auth') order by schemaname,tablename")).rows;
 const content=[];
 for(const t of names){const qualified='"'+t.schemaname+'"."'+t.tablename+'"';content.push([qualified,(await database.query(`select to_jsonb(t)::text v from ${qualified} t order by to_jsonb(t)::text`)).rows]);}
 return {tables:names.length,sha256:createHash('sha256').update(JSON.stringify(content)).digest('hex')};
}
beforeAll(async()=>{
 if(url){
  // Never seed, dump, restore or load-test a supplied hosted database.
  if(url!=='postgresql://postgres@127.0.0.1:55433/phase26_source')throw Error('Only the dedicated disposable loopback database is allowed');
  db=new Pool({connectionString:url});
  if((await db.query("select exists(select 1 from pg_tables where schemaname not in ('pg_catalog','information_schema')) present")).rows[0].present)throw Error('Source must be empty; no reset is performed');
  await seedDatabase({exec:(sql:string)=>db.query(sql),query:(sql:string,p?:any[])=>db.query(sql,p)} as any);
  runtime=new Pool({connectionString:url,max:4,connectionTimeoutMillis:3000,statement_timeout:3000,query_timeout:4000,options:'-c role=app_backend'});
 }else db=await fixture();
 provider=createServer((req,res)=>{const id=accepted.get(req.headers.authorization?.slice(7)??'');res.setHeader('Content-Type','application/json');res.statusCode=id?200:401;res.end(JSON.stringify(id?{id,is_anonymous:false}:{}));});
 await new Promise<void>(r=>provider.listen(0,'127.0.0.1',r));
 const providerUrl=`http://127.0.0.1:${(provider.address() as AddressInfo).port}`;issuer=providerUrl+'/auth/v1';
 const config=loadConfig({NODE_ENV:'test',SUPABASE_URL:providerUrl,SUPABASE_PUBLISHABLE_KEY:'local-public-fixture'});service=new DatabaseService(config);
 service.pool=runtime??{connect:async()=>({query:async(sql:string,values?:any[])=>{
  if(sql.startsWith('BEGIN')){await db.exec('BEGIN; SET LOCAL ROLE app_backend;');return{rows:[],rowCount:0};}
  const r=await db.query(sql,values);return{rows:r.rows,rowCount:r.command==='SELECT'?r.rows.length:r.affectedRows??r.rows.length};
 },release:()=>{}})};
 app=await createApp(config,service);await app.listen(0,'127.0.0.1');origin=await app.getUrl();
 bearer=token(ids.adminA,ids.session);other=token(ids.adminB,ids.sessionB);reader=token(ids.reader,ids.sessionRead);
 await service.asActor({userId:ids.adminA,sessionId:ids.session},ids.a,async(c:any)=>{
  await c.query("insert into app.units(company_id,code,name,symbol,dimension) values($1,'KG','Kilogram','kg','mass')",[ids.a]);
  owner=(await c.query("insert into app.stock_owners(company_id,code,name,kind) values($1,'OWN','Local owner','company') returning id",[ids.a])).rows[0].id;
  location=(await c.query("insert into app.locations(company_id,code,name) values($1,'L','Local source') returning id",[ids.a])).rows[0].id;
  target=(await c.query("insert into app.locations(company_id,code,name) values($1,'T','Local target') returning id",[ids.a])).rows[0].id;
 });
},60000);
afterAll(async()=>{await app?.close();await runtime?.end();await new Promise<void>(r=>provider?provider.close(()=>r()):r());if(url)await db?.end();else await db?.close();});
it('integrates imports, receipts, transfers, shipment reservations, reports and forecast without double posting',async()=>{
 await importRows('customers','code;name\nC;Local customer');await importRows('suppliers','code;name\nS;Local supplier');
 await importRows('materials','code;name;unit_code;supplier_code\nM;Local material;KG;S');
 item=(await db.query("select id from app.items where code='M'")).rows[0].id;customer=(await db.query("select id from app.customers where code='C'")).rows[0].id;
 const opening=await importRows('opening_stock','item_code;owner_code;location_code;quantity\nM;OWN;L;100.00000001');expect(opening.receipt.result).toHaveLength(1);
 const receipt={idempotency_key:key(),item_id:item,owner_id:owner,location_id:location,quantity:'9.99999999',comment:'Integration receipt'};
 const first=await ok(base()+'/receipts','POST',receipt,201);expect((await ok(base()+'/receipts','POST',receipt,201)).id).toBe(first.id);
 await ok(base()+'/transfers','POST',{idempotency_key:key(),item_id:item,owner_id:owner,from_location_id:location,to_location_id:target,quantity:'20',comment:'Integration transfer'},201);
 shipment=await ok(base()+'/shipments','POST',{idempotency_key:key(),version:0,reason:'Integration shipment',data:{code:'INTEGRATION',customer_id:customer,ship_date:new Date().toISOString().slice(0,10),lines:[{item_id:item,owner_id:owner,location_id:target,quantity:'8'}]}},201);
 for(const action of ['plan','reserve'])shipment=await ok(base()+`/shipments/${shipment.id}/${action}`,'POST',{idempotency_key:key(),version:shipment.version,reason:'Integration transition'},201);
 const forecastBody={item_id:item,owner_id:owner,to:new Date(Date.now()+86400000).toISOString().slice(0,10)};
 const before=await ok(base()+'/forecast/preview','POST',forecastBody);expect(before.physical).toBe('110');expect(before.projected_available).toBe('102');
 shipment=await ok(base()+`/shipments/${shipment.id}/ready`,'POST',{idempotency_key:key(),version:shipment.version,reason:'Ready shipment'},201);
 const dispatch={idempotency_key:key(),version:shipment.version,reason:'Dispatch integration shipment'};
 shipment=await ok(base()+`/shipments/${shipment.id}/dispatch`,'POST',dispatch,201);expect((await ok(base()+`/shipments/${shipment.id}/dispatch`,'POST',dispatch,201)).entry_id).toBe(shipment.entry_id);
 const after=await ok(base()+'/forecast/preview','POST',forecastBody);expect(after.physical).toBe('102');expect(after.projected_available).toBe('102');
 const report=await ok(base()+'/reports/stock');expect(report.items).toHaveLength(2);expect(report.items.map((x:any)=>x.quantity).sort()).toEqual(['12.00000000','90.00000000']);
 expect((await db.query('select sum(quantity)::text q from app.inventory_lines')).rows[0].q).toBe('102.00000000');
 expect((await db.query('select sum(quantity)::text q,sum(reserved_quantity)::text r from app.stock_balances')).rows[0]).toEqual({q:'102.00000000',r:'0.00000000'});
 expect((await db.query("select count(*)::int n from app.inventory_entries where kind='shipment'")).rows[0].n).toBe(1);
 const exported=await ok(base()+'/reports/inventory/export','POST',{},201);expect(exported.sha256).toBe(createHash('sha256').update(exported.csv).digest('hex'));expect((await ok(base()+'/reports/exports')).items).toHaveLength(1);
},60000);
it('rejects cross-company and read-only access across the integrated flow and preserves disabled photos',async()=>{
 for(const suffix of ['/access','/reports/stock','/forecast/options','/imports/materials/history','/shipments']){
  expect((await call(base()+suffix,'GET',undefined,other)).status).toBe(403);
  expect((await call(base(ids.b)+suffix)).status).toBe(403);
 }
 expect((await call(base()+'/forecast/options','GET',undefined,reader)).status).toBe(403);
 expect((await call(base()+'/imports/customers/preview','POST',{filename:'denied.csv',csv:'code;name\nDENIED;Denied'},reader)).status).toBe(403);
 expect((await call(base()+`/shipments/${shipment.id}`,'GET',undefined,'invalid')).status).toBe(401);
 expect(await ok(base()+`/items/material/${item}/photo`)).toEqual({enabled:false,photo:null});
 const scope=await db.query("select has_schema_privilege('anon','app','USAGE') a,has_schema_privilege('authenticated','app','USAGE') b,has_schema_privilege('app_backend','app_private','USAGE') c");expect(scope.rows[0]).toEqual({a:false,b:false,c:false});
});
it.skipIf(!url)('bounds concurrent HTTP load and proves actor isolation when four pooled connections are reused',async()=>{
 const before=await snapshot();const durations:number[]=[];const start=performance.now();
 // Ten workers, 120 bounded reads. No external endpoints or hosted data.
 await Promise.all(Array.from({length:10},async(_,worker)=>{
  for(let n=0;n<12;n++){
   const index=worker*12+n,t=performance.now(),foreign=index%3===0;
   const r=await call(base()+(index%2?'/reports/stock':'/forecast/options'),'GET',undefined,foreign?other:bearer);
   expect(r.status).toBe(foreign?403:200);const body=await r.json();if(!foreign)expect(body.company_id).toBe(ids.a);durations.push(performance.now()-t);
  }
 }));
 durations.sort((a,b)=>a-b);const p95=durations[Math.ceil(durations.length*.95)-1];
 expect(p95).toBeLessThan(5000);expect(performance.now()-start).toBeLessThan(45000);expect(runtime!.totalCount).toBeLessThanOrEqual(4);expect(runtime!.waitingCount).toBe(0);expect(await snapshot()).toEqual(before);
 console.log('PHASE26_LOCAL_LOAD',JSON.stringify({requests:120,workers:10,poolMax:4,p95Ms:Math.round(p95),elapsedMs:Math.round(performance.now()-start)}));
},60000);
it.skipIf(!url)('restores a real PostgreSQL archive, retains journals/ACL/RLS and resumes idempotent business reads',async()=>{
 const before=await snapshot();const started=performance.now();
 const emptyTarget=new Pool({connectionString:'postgresql://postgres@127.0.0.1:55434/phase26_restored'});
 try { expect((await emptyTarget.query("select count(*)::int n from pg_tables where schemaname not in ('pg_catalog','information_schema')")).rows[0].n).toBe(0); } finally { await emptyTarget.end(); }
 // Fixed dedicated local container; no shell interpolation, URLs or hosted credentials.
 const archive=execFileSync('docker',['exec','phase26-postgres','pg_dump','-U','postgres','-Fc','phase26_source'],{maxBuffer:16*1024*1024,timeout:30000});
 const roles=execFileSync('docker',['exec','phase26-postgres','pg_dumpall','-U','postgres','--roles-only','--no-role-passwords'],{maxBuffer:1024*1024,timeout:30000});
 // Both clusters use the same bootstrap role. Skip only its already-existing CREATE; preserve ALTER and all grants.
 const roleSql=roles.toString('utf8');expect(roleSql.split('\n').filter(line=>line==='CREATE ROLE postgres;')).toHaveLength(1);
 execFileSync('docker',['exec','-i','phase26-restore','psql','-U','postgres','-d','phase26_restored','--set=ON_ERROR_STOP=1'],{input:roleSql.replace('CREATE ROLE postgres;\n',''),maxBuffer:1024*1024,timeout:30000});
 execFileSync('docker',['exec','-i','phase26-restore','pg_restore','-U','postgres','--exit-on-error','-d','phase26_restored'],{input:archive,maxBuffer:1024*1024,timeout:30000});
 const restored=new Pool({connectionString:'postgresql://postgres@127.0.0.1:55434/phase26_restored'});
 const restoredRuntime=new Pool({connectionString:'postgresql://postgres@127.0.0.1:55434/phase26_restored',max:4,options:'-c role=app_backend'});
 const previous=service.pool;
 try{
  expect(await snapshot(restored)).toEqual(before);
  const catalog=async(p:any)=>(await p.query("select n.nspname,c.relname,c.relrowsecurity,c.relforcerowsecurity,c.relacl::text,pg_get_userbyid(c.relowner) owner from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('app','app_private') order by 1,2")).rows;
  expect(await catalog(restored)).toEqual(await catalog(db));
  const memberships=async(p:any)=>(await p.query("select r.rolname role,m.rolname member,g.rolname grantor,a.admin_option,a.inherit_option,a.set_option from pg_auth_members a join pg_roles r on r.oid=a.roleid join pg_roles m on m.oid=a.member join pg_roles g on g.oid=a.grantor order by 1,2,3")).rows;
  expect(await memberships(restored)).toEqual(await memberships(db));service.pool=restoredRuntime;
  expect((await ok(base()+'/reports/stock')).items).toHaveLength(2);
  expect((await call(base()+'/reports/stock','GET',undefined,other)).status).toBe(403);
  const original=(await restored.query("select id,job_id from app.import_receipts where kind='opening_stock'")).rows[0];
  const replay=await ok(base()+`/imports/opening_stock/${original.job_id}/confirm`,'POST',{confirm:true},201);expect(replay.replayed).toBe(true);expect(replay.receipt.id).toBe(original.id);
  expect(await snapshot(restored)).toEqual(before);
  console.log('PHASE26_LOCAL_RESTORE',JSON.stringify({tables:before.tables,archiveBytes:archive.length,archiveSha256:createHash('sha256').update(archive).digest('hex'),elapsedMs:Math.round(performance.now()-started)}));
 }finally{service.pool=previous;await restoredRuntime.end();await restored.end();}
},60000);
it('revokes the previously accepted session across modules without affecting the other company',async()=>{
 await db.query('delete from auth.sessions where id=$1',[ids.session]);
 for(const suffix of ['/access','/reports/stock','/forecast/options'])expect((await call(base()+suffix)).status).toBe(401);
 expect((await call(base(ids.b)+'/access','GET',undefined,other)).status).toBe(200);
});
