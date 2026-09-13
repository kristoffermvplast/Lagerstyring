import { createRequire } from 'node:module';
import { createServer, Server } from 'node:http';
import { AddressInfo } from 'node:net';
import { beforeAll,afterAll,it,expect,describe } from 'vitest';
import { fixture,ids,asUser } from './helpers/access-fixture';
const require=createRequire(import.meta.url);
const {createApp}=require('../apps/api/dist/app.js');
const {loadConfig}=require('../apps/api/dist/config.js');
const {DatabaseService}=require('../apps/api/dist/database.js');
let db:Awaited<ReturnType<typeof fixture>>;let app:any;let provider:Server;let origin:string;let issuer:string;
const accepted=new Map<string,string>();
function token(user:string,session:string,overrides:Record<string,unknown>={}){
 const value=Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url')+'.'+Buffer.from(JSON.stringify({sub:user,session_id:session,iss:issuer,role:'authenticated',aud:'authenticated',exp:Math.floor(Date.now()/1000)+300,...overrides})).toString('base64url')+'.fixture-signature';
 accepted.set(value,user);return value;
}
async function call(path:string,bearer?:string,method='GET',body?:unknown){return fetch(origin+'/api'+path,{method,headers:{...(bearer?{Authorization:'Bearer '+bearer}:{}),'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});}
beforeAll(async()=>{
 db=await fixture();
 // Local Auth boundary stub: only explicitly registered exact tokens accepted.
 provider=createServer((req,res)=>{const bearer=req.headers.authorization?.slice(7)??'';const id=accepted.get(bearer);res.setHeader('Content-Type','application/json');res.statusCode=id?200:401;res.end(JSON.stringify(id?{id,email:'fixture@example.test',is_anonymous:false}:{}));});
 await new Promise<void>(resolve=>provider.listen(0,'127.0.0.1',resolve));
 const providerUrl=`http://127.0.0.1:${(provider.address() as AddressInfo).port}`;issuer=providerUrl+'/auth/v1';
 const config=loadConfig({NODE_ENV:'test',SUPABASE_URL:providerUrl,SUPABASE_PUBLISHABLE_KEY:'test-public-key'});
 const service=new DatabaseService(config);
 // Exercise the real transaction and revocation implementation using PostgreSQL in-process.
 const queries:string[]=[];
 service.pool={connect:async()=>({query:async(sql:string,values?:unknown[])=>{
 queries.push(sql);if(sql.startsWith('BEGIN'))await db.exec('BEGIN; SET LOCAL ROLE app_backend;');
 else {const result=await db.query(sql,values);return {rows:result.rows,rowCount:result.command==='SELECT'?result.rows.length:result.affectedRows??result.rows.length};}
 return {rows:[],rowCount:0};
 },release:()=>{}})};
 app=await createApp(config,service);await app.listen(0,'127.0.0.1');origin=await app.getUrl();
});
afterAll(async()=>{await app?.close();await new Promise<void>(resolve=>provider?.close(()=>resolve()));await db?.close();});

let product:string,material:string,box:string,unit:string,machine:string,bom:string,packing:string,owner:string,location:string,target:string,order:any,entry:any;
const path=(company=ids.a,id=order.id)=>`/companies/${company}/production-orders/${id}/deliveries`;
const body=()=>({idempotency_key:crypto.randomUUID(),item_id:material,owner_id:owner,from_location_id:location,to_location_id:target,quantity:'8.00000001',comment:'Local material issue'});
beforeAll(async()=>{await asUser(db,ids.adminA,ids.a,async()=>{

 unit=(await db.query<any>("insert into app.units(company_id,code,name,symbol,dimension) values($1,'PCS','Piece','stk.','count') returning id",[ids.a])).rows[0].id;
 const kg=(await db.query<any>("insert into app.units(company_id,code,name,symbol,dimension) values($1,'KG','Kilogram','kg','mass') returning id",[ids.a])).rows[0].id;
 machine=(await db.query<any>("insert into app.machines(company_id,code,name) values($1,'M','Test machine') returning id",[ids.a])).rows[0].id;
 product=(await db.query<any>("insert into app.items(company_id,kind,code,name,unit_id,standard_machine_id) values($1,'product','P','Original product',$2,$3) returning id",[ids.a,unit,machine])).rows[0].id;
 material=(await db.query<any>("insert into app.items(company_id,kind,code,name,unit_id) values($1,'material','X','Material',$2) returning id",[ids.a,kg])).rows[0].id;
 box=(await db.query<any>("insert into app.items(company_id,kind,code,name,unit_id) values($1,'packaging','BOX','Box',$2) returning id",[ids.a,unit])).rows[0].id;
 for(const kind of ['bom','packing']) {
  const r=(await db.query<any>('insert into app.recipes(company_id,product_id,kind,name) values($1,$2,$3,$3) returning id',[ids.a,product,kind])).rows[0].id;
  const v=(await db.query<any>('insert into app.recipe_revisions(company_id,recipe_id,revision) values($1,$2,1) returning id',[ids.a,r])).rows[0].id;
  await db.query('insert into app.recipe_lines(company_id,revision_id,component_id,kind,quantity) values($1,$2,$3,$4,$5)',[ids.a,v,kind==='bom'?material:box,kind==='bom'?'component':'container',kind==='bom'?'0.00825':'12']);
  await db.query('update app.recipe_revisions set sealed=true where id=$1',[v]);
  await db.query('update app.recipes set current_revision_id=$2,is_default=true,version=version+1 where id=$1',[r,v]);
  if(kind==='bom')bom=v;else packing=v;
 }

 owner=(await db.query<any>("insert into app.stock_owners(company_id,code,name,kind) values($1,'OWN','External owner','other') returning id",[ids.a])).rows[0].id;
 location=(await db.query<any>("insert into app.locations(company_id,code,name) values($1,'L','Warehouse') returning id",[ids.a])).rows[0].id;
 target=(await db.query<any>("insert into app.locations(company_id,code,name) values($1,'T','Production') returning id",[ids.a])).rows[0].id;
 await db.query('update app.machines set location_id=$2,version=version+1 where id=$1',[machine,target]);
 for(const i of [material,box])await db.query("insert into app.inventory_entries(company_id,idempotency_key,kind,reason,request) values($1,$2,'correction','Opening test stock',$3)",[ids.a,crypto.randomUUID(),JSON.stringify([{item_id:i,owner_id:owner,location_id:location,quantity:'10'}])]);
 });
 for(const code of ['production.read','inventory.read','inventory.transfer'])await db.query('insert into app.role_permissions values($1,$2,$3)',[ids.a,ids.readRole,code]);
 const r=await call(`/companies/${ids.a}/production-orders`,token(ids.adminA,ids.session),'POST',{idempotency_key:crypto.randomUUID(),product_id:product,code:'ISSUE-TEST',quantity:'504',machine_id:machine,bom_revision_id:bom,packing_revision_id:packing});expect(r.status).toBe(201);order=await r.json();
});

let issue:any,returned:any,closed:any;
const bearer=()=>token(ids.adminA,ids.session);
const returns=()=>({idempotency_key:crypto.randomUUID(),issue_id:issue.id,to_location_id:location,quantity:'2',comment:'Unused material returned'});
async function status(value:string){const r=await call(`/companies/${ids.a}/production-orders/${order.id}/status`,bearer(),'POST',{version:order.version,status:value});expect(r.status).toBe(201);order=await r.json();}
async function review(){return(await call(path().replace('/waste','/close')+'/review',bearer())).json();}
beforeAll(async()=>{
 await status('planned');await status('ready');await status('in_production');
 const r=await call(`/companies/${ids.a}/production-orders/${order.id}/material-issues`,bearer(),'POST',body());expect(r.status).toBe(201);issue=await r.json();
 expect((await call(`/companies/${ids.a}/production-orders/${order.id}/registrations`,bearer(),'POST',{idempotency_key:crypto.randomUUID(),quantity:'500'})).status).toBe(201);
});

const output=()=>({idempotency_key:crypto.randomUUID(),quantity:'100',owner_id:owner,location_id:location,production_date:'2026-09-01',comment:'Test finished output'});
let released:any,hu:any,pallet:string;
beforeAll(async()=>{await asUser(db,ids.adminA,ids.a,async()=>{pallet=(await db.query<any>("insert into app.pallet_types(company_id,code,name) values($1,'P','Test pallet') returning id",[ids.a])).rows[0].id;});});
it('enforces anonymous and tenant boundaries on all output routes',async()=>{
 for(const suffix of ['','/summary','/'+crypto.randomUUID()]){expect((await call(path()+suffix)).status).toBe(401);expect((await call(path(ids.b)+suffix,bearer())).status).toBe(403);expect((await call(path(ids.a,crypto.randomUUID())+suffix,bearer())).status).toBe(404);}
 const root=`/companies/${ids.a}/handling-units`;expect((await call(root)).status).toBe(401);expect((await call(`/companies/${ids.b}/handling-units`,bearer())).status).toBe(403);
 expect((await call(path(),token(ids.reader,ids.sessionRead),'POST',output())).status).toBe(403);
});
it('delivers a partial pallet exactly once, preserving ownership and frozen packing',async()=>{
 const b={...output(),pallet_type_id:pallet};const r=await call(path(),bearer(),'POST',b);expect(r.status).toBe(201);released=await r.json();
 expect((await(await call(path(),bearer(),'POST',b)).json()).id).toBe(released.id);expect((await call(path(),bearer(),'POST',{...b,quantity:'101'})).status).toBe(409);
 const summary=await(await call(path()+'/summary',bearer())).json();expect(Number(summary.delivered_quantity)).toBe(100);expect(Number(summary.remaining_quantity)).toBe(400);
 hu=(await(await call(`/companies/${ids.a}/handling-units`,bearer())).json()).items[0];expect(hu.snapshot.owner.id).toBe(owner);expect(hu.snapshot.packing.id).toBe(packing);expect(hu.order_id).toBe(order.id);
 const balances=(await db.query<any>('select * from app.stock_balances where item_id=$1',[product])).rows;expect(balances.length).toBe(1);expect(Number(balances[0].quantity)).toBe(100);
});
it('rejects overdelivery and production reversal below delivered stock',async()=>{
 expect((await call(path(),bearer(),'POST',{...output(),quantity:'401'})).status).toBe(409);
 const reg=(await db.query<any>("select id from app.production_registrations where order_id=$1 and kind='record'",[order.id])).rows[0].id;
 expect((await call(path().replace('/deliveries','/registrations')+'/'+reg+'/reverse',bearer(),'POST',{idempotency_key:crypto.randomUUID(),comment:'Would invalidate output'})).status).toBe(409);
});
it('protects pallet balances from generic corrections and moves whole pallet with immutable history',async()=>{
 await expect(asUser(db,ids.adminA,ids.a,()=>db.query("insert into app.inventory_entries(company_id,idempotency_key,kind,reason,request) values($1,$2,'correction','Unsafe pallet debit',$3)",[ids.a,crypto.randomUUID(),JSON.stringify([{item_id:product,owner_id:owner,location_id:location,quantity:'-1'}])]))).rejects.toThrow();
 const url=`/companies/${ids.a}/handling-units/${hu.id}/moves`;const b={idempotency_key:crypto.randomUUID(),to_location_id:target,comment:'Move whole pallet'};
 const r=await call(url,bearer(),'POST',b);expect(r.status).toBe(201);const m=await r.json();expect((await(await call(url,bearer(),'POST',b)).json()).id).toBe(m.id);
 expect((await call(path()+'/'+released.id+'/reverse',bearer(),'POST',{idempotency_key:crypto.randomUUID(),comment:'Cannot reverse moved pallet'})).status).toBe(409);
 expect((await call(url,bearer(),'POST',{...b,idempotency_key:crypto.randomUUID(),to_location_id:location})).status).toBe(201);
 expect((await(await call(url,bearer())).json()).items.length).toBe(2);
});
it('reverses output with audit once and permits subsequent production correction',async()=>{
 const b={idempotency_key:crypto.randomUUID(),comment:'Wrong physical delivery'};const url=path()+'/'+released.id+'/reverse';const r=await call(url,bearer(),'POST',b);expect(r.status).toBe(201);const rev=await r.json();expect((await(await call(url,bearer(),'POST',b)).json()).id).toBe(rev.id);
 expect((await(await call(`/companies/${ids.a}/handling-units/${hu.id}`,bearer())).json()).active).toBe(false);
 expect(Number((await(await call(path()+'/summary',bearer())).json()).delivered_quantity)).toBe(0);
});
it('blocks runtime journal forgery, snapshot writes, history edits and cross-company access',async()=>{
 await expect(asUser(db,ids.adminA,ids.a,()=>db.query("insert into app.inventory_entries(company_id,idempotency_key,kind,reason,request) values($1,$2,'production_output','Forged output','[]')",[ids.a,crypto.randomUUID()]))).rejects.toThrow();
 await expect(asUser(db,ids.adminA,ids.a,()=>db.query("update app.handling_units set active=true where id=$1",[hu.id]))).rejects.toThrow();
 await expect(asUser(db,ids.adminA,ids.a,()=>db.query("delete from app.production_deliveries where id=$1",[released.id]))).rejects.toThrow();
 expect(await asUser(db,ids.adminA,ids.a,async()=>(await db.query('select * from app.production_deliveries where company_id=$1',[ids.b])).rows)).toEqual([]);
});
it('supports loose output and preserves production snapshot after masterdata edit',async()=>{
 await asUser(db,ids.adminA,ids.a,()=>db.query("update app.items set name='Renamed product',version=version+1 where id=$1",[product]));
 const r=await call(path(),bearer(),'POST',{...output(),quantity:'200'});expect(r.status).toBe(201);const d=await r.json();expect(d.snapshot.product.name).toBe('Original product');expect(d.pallet_type_id).toBeNull();
 expect((await(await call(`/companies/${ids.a}/handling-units`,bearer())).json()).total).toBe(1);
});

it('rejects fractional count, future dates and protected snapshot injection',async()=>{
 expect((await call(path(),bearer(),'POST',{...output(),quantity:'0.5'})).status).toBe(409);
 expect((await call(path(),bearer(),'POST',{...output(),production_date:'2999-01-01'})).status).toBe(409);
 expect((await call(path(),bearer(),'POST',{...output(),snapshot:{}})).status).toBe(400);
});
it('permits post-closure delivery without changing consumption or registration',async()=>{
 await status('reconciliation');const rev=await(await call(path().replace('/deliveries','/close')+'/review',bearer())).json();
 const closed=await call(path().replace('/deliveries','/close'),bearer(),'POST',{idempotency_key:crypto.randomUUID(),review_token:rev.review_token,rejected_quantity:'0',comment:'Close output fixture',confirm_materials:true});expect(closed.status).toBe(201);
 const before=(await db.query<any>("select snapshot from app.production_closures where order_id=$1",[order.id])).rows[0].snapshot;
 const consumption=(await db.query<any>("select count(*)::int n from app.inventory_entries where kind='production_consumption'")).rows[0].n;
 expect((await call(path(),bearer(),'POST',output())).status).toBe(201);
 expect((await db.query<any>("select count(*)::int n from app.inventory_entries where kind='production_consumption'")).rows[0].n).toBe(consumption);
 expect((await db.query<any>("select snapshot from app.production_closures where order_id=$1",[order.id])).rows[0].snapshot).toEqual(before);
});
