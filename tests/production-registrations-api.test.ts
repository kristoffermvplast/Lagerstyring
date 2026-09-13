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

const path=(company=ids.a)=>`/companies/${company}/production-orders`;
let product:string,material:string,box:string,unit:string,machine:string,bom:string,packing:string,order:any;
const input=()=>({idempotency_key:crypto.randomUUID(),product_id:product,code:'PO-'+crypto.randomUUID(),quantity:'504',machine_id:machine,bom_revision_id:bom,packing_revision_id:packing});
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
 });await db.query("insert into app.role_permissions values($1,$2,'production.read')",[ids.a,ids.readRole]);});
const registrations=(c=ids.a,id=order.id)=>path(c)+'/'+id+'/registrations';
const admin=()=>token(ids.adminA,ids.session);
const rec=(q='500')=>({idempotency_key:crypto.randomUUID(),quantity:q,boxes:10,comment:'Test production'});
let saved:any,keybody:any;
it('requires auth, explicit permission, tenant scope and a running order',async()=>{
 order=await(await call(path(),admin(),'POST',input())).json();
 expect((await call(registrations())).status).toBe(401);
 expect((await call(registrations(ids.b),admin())).status).toBe(403);
 expect((await call(registrations(),token(ids.reader,ids.sessionRead),'POST',rec())).status).toBe(403);
 expect((await call(registrations(),admin(),'POST',rec())).status).toBe(409);
 for(const status of ['planned','ready','in_production']){const r=await call(path()+'/'+order.id+'/status',admin(),'POST',{version:order.version,status});expect(r.status).toBe(201);order=await r.json();}
 expect(order.status).toBe('in_production');
 expect((await call(path()+'/'+order.id+'/status',admin(),'POST',{version:order.version,status:'planned'})).status).toBe(409);
});
it('records increments exactly once, conserves inventory, reports overproduction and preserves snapshots',async()=>{
 keybody=rec();const r=await call(registrations(),admin(),'POST',keybody);expect(r.status).toBe(201);saved=await r.json();
 expect(saved.snapshot.product.name).toBe('Original product');expect(saved.created_by).toBe(ids.adminA);
 expect((await(await call(registrations(),admin(),'POST',keybody)).json()).id).toBe(saved.id);
 expect((await call(registrations(),admin(),'POST',{...keybody,quantity:'501'})).status).toBe(409);
 expect((await call(registrations(),admin(),'POST',rec('5'))).status).toBe(201);
 const total=await(await call(registrations()+'/summary',admin())).json();expect(total.good_quantity).toBe('505.00000000');expect(total.overproduced).toBe(true);expect(total.progress_percent).toBe('100.19');
 expect((await db.query<any>('select count(*)::int n from app.inventory_entries')).rows[0].n).toBe(0);
 await asUser(db,ids.adminA,ids.a,()=>db.query("update app.items set name='Renamed product',version=version+1 where id=$1",[product]));
 expect((await(await call(registrations()+'/'+saved.id,admin())).json()).snapshot.product.name).toBe('Original product');
});
it('rejects invalid values, forged fields, foreign references and non-whole pieces without writes',async()=>{
 const before=(await db.query<any>('select count(*)::int n from app.production_registrations')).rows[0].n;
 for(const delta of [{quantity:'0'},{quantity:'-1'},{quantity:'NaN'},{quantity:'1e2'},{quantity:'0.000000001'},{quantity:'1.5'},{quantity:1},{boxes:-1},{boxes:1.5},{snapshot:{}},{created_by:ids.adminB}])expect([400,409]).toContain((await call(registrations(),admin(),'POST',{...rec(),...delta})).status);
 expect((await call(registrations(ids.a,crypto.randomUUID()),admin())).status).toBe(404);
 expect((await call(registrations()+'/'+crypto.randomUUID(),admin())).status).toBe(404);
 expect((await db.query<any>('select count(*)::int n from app.production_registrations')).rows[0].n).toBe(before);
});
it('permits record-only operators without planning rights and enforces independent correction rights',async()=>{
 for(const code of ['production.read','production.record'])await db.query('insert into app.role_permissions values($1,$2,$3) on conflict do nothing',[ids.a,ids.readRole,code]);
 const reader=token(ids.reader,ids.sessionRead);expect((await call(registrations(),reader,'POST',rec('1'))).status).toBe(201);
 expect((await call(registrations()+'/'+saved.id+'/reverse',reader,'POST',{idempotency_key:crypto.randomUUID(),comment:'Wrong quantity'})).status).toBe(403);
 expect((await call(path()+'/'+order.id+'/problem',reader,'POST',{version:order.version,problem:'x'})).status).toBe(403);
});
it('blocks new records on problem but allows reasoned full reversal once with immutable history',async()=>{
 order=await(await call(path()+'/'+order.id+'/problem',admin(),'POST',{version:order.version,problem:'Check quality'})).json();
 expect((await call(registrations(),admin(),'POST',rec())).status).toBe(409);
 const b={idempotency_key:crypto.randomUUID(),comment:'Incorrect tally'};
 const r=await call(registrations()+'/'+saved.id+'/reverse',admin(),'POST',b);expect(r.status).toBe(201);const reverse=await r.json();expect(reverse.quantity).toBe(saved.quantity);expect(reverse.snapshot).toEqual(saved.snapshot);
 expect((await(await call(registrations()+'/'+saved.id+'/reverse',admin(),'POST',b)).json()).id).toBe(reverse.id);
 expect((await call(registrations()+'/'+saved.id+'/reverse',admin(),'POST',{...b,idempotency_key:crypto.randomUUID()})).status).toBe(409);
 expect((await call(registrations()+'/'+reverse.id+'/reverse',admin(),'POST',{...b,idempotency_key:crypto.randomUUID()})).status).toBe(404);
 expect((await(await call(registrations()+'/summary',admin())).json()).good_quantity).toBe('6.00000000');
 for(const sql of ['update app.production_registrations set quantity=1','delete from app.production_registrations'])await expect(asUser(db,ids.adminA,ids.a,()=>db.exec(sql))).rejects.toThrow();
 const list=await(await call(registrations()+'?limit=1',admin())).json();expect(list.items).toHaveLength(1);expect(list.total).toBe(4);
});
it('database denies cross-company reads, protected columns and direct internal execution',async()=>{
 await asUser(db,ids.adminB,ids.b,async()=>{expect((await db.query('select * from app.production_registrations')).rows).toHaveLength(0);},ids.sessionB);
 const permissions=(await db.query<any>("select has_column_privilege('app_backend','app.production_registrations','snapshot','INSERT') snapshot,has_column_privilege('app_backend','app.production_registrations','quantity','UPDATE') update_quantity,has_function_privilege('app_backend','app_private.prepare_production_registration()','EXECUTE') execute_guard,has_table_privilege('authenticated','app.production_registrations','SELECT') browser_read")).rows[0];expect(Object.values(permissions)).toEqual([false,false,false,false]);
 await db.query('delete from auth.sessions where id=$1',[ids.sessionRead]);
 expect((await call(registrations(),token(ids.reader,ids.sessionRead))).status).toBe(401);
});

it('aggregates beyond a single numeric field limit without floating point or overflow',async()=>{
 order=await(await call(path()+'/'+order.id+'/problem',admin(),'POST',{version:order.version,problem:''})).json();
 for(let i=0;i<2;i++)expect((await call(registrations(),admin(),'POST',rec('999999999999'))).status).toBe(201);
 const r=await call(registrations()+'/summary',admin());expect(r.status).toBe(200);expect((await r.json()).good_quantity).toBe('2000000000004.00000000');
});
