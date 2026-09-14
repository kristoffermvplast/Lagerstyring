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

const path=(company=ids.a)=>`/companies/${company}/reservations`;
let item:string,owner:string,location:string,reservation:any;
it('reserves exact stock once without changing physical journal and releases once',async()=>{
 await asUser(db,ids.adminA,ids.a,async()=>{
 const unit=(await db.query<any>("insert into app.units(company_id,code,name,symbol,dimension) values($1,'KG','Kilogram','kg','mass') returning id",[ids.a])).rows[0].id;
 item=(await db.query<any>("insert into app.items(company_id,kind,code,name,unit_id) values($1,'material','M','Material',$2) returning id",[ids.a,unit])).rows[0].id;
 owner=(await db.query<any>("insert into app.stock_owners(company_id,code,name,kind) values($1,'OWN','Owner','company') returning id",[ids.a])).rows[0].id;
 location=(await db.query<any>("insert into app.locations(company_id,code,name) values($1,'L','Location') returning id",[ids.a])).rows[0].id;
 await db.query("insert into app.inventory_entries(company_id,idempotency_key,kind,reason,request) values($1,$2,'correction','Opening stock',$3)",[ids.a,crypto.randomUUID(),JSON.stringify([{item_id:item,owner_id:owner,location_id:location,quantity:'10.00825001'}])]);
 });
 const t=token(ids.adminA,ids.session),body={idempotency_key:crypto.randomUUID(),item_id:item,owner_id:owner,location_id:location,quantity:'8.00825001',reference:'Customer order',reason:'Reserve for customer'};
 const first=await call(path(),t,'POST',body);expect(first.status).toBe(201);reservation=await first.json();expect(reservation.quantity).toBe('8.00825001');expect(reservation.events).toHaveLength(1);
 expect((await(await call(path(),t,'POST',body)).json()).id).toBe(reservation.id);
 expect((await call(path(),t,'POST',{...body,quantity:'1'})).status).toBe(409);
 expect((await call(path(),t,'POST',{...body,idempotency_key:crypto.randomUUID(),quantity:'3'})).status).toBe(409);
 const balance=(await(await call(`/companies/${ids.a}/inventory/balances`,t)).json()).items[0];expect(balance.quantity).toBe('10.00825001');expect(balance.reserved_quantity).toBe('8.00825001');expect(balance.available_quantity).toBe('2.00000000');
 expect((await db.query<any>('select count(*)::int n from app.inventory_entries')).rows[0].n).toBe(1);
 expect((await(await call(path()+'?active=true',t)).json()).total).toBe(1);
});
it('denies anonymous, foreign company, forged quantities and runtime projection writes',async()=>{
 const t=token(ids.adminA,ids.session);
 for(const route of [path(),path()+'/'+reservation.id])expect((await call(route)).status).toBe(401);
 for(const route of [path(ids.b),path(ids.b)+'/'+reservation.id])expect((await call(route,t)).status).toBe(403);
 expect((await call(path()+'/'+crypto.randomUUID(),t)).status).toBe(404);
 const other=token(ids.adminB,ids.sessionB);expect((await call(path(ids.b)+'/'+reservation.id,other)).status).toBe(404);
 expect((await call(path(ids.b)+'/'+reservation.id+'/release',other,'POST',{idempotency_key:crypto.randomUUID(),reason:'Foreign release'})).status).toBe(404);
 for(const quantity of ['0','-1','NaN','1e2','0.000000001',1])expect((await call(path(),t,'POST',{idempotency_key:crypto.randomUUID(),item_id:item,owner_id:owner,location_id:location,quantity,reference:'Ref',reason:'Test invalid'})).status).toBe(400);
 for(const sql of ['update app.stock_reservations set active=false','delete from app.reservation_events','update app.stock_balances set reserved_quantity=0','update app.handling_units set reserved_quantity=0','select app_private.post_reservation()'])await expect(asUser(db,ids.adminA,ids.a,()=>db.exec(sql))).rejects.toMatchObject({code:'42501'});
});
it('protects reservations against generic debits, preserves snapshots and permits exact release after deactivation',async()=>{
 const t=token(ids.adminA,ids.session);
 const debit={idempotency_key:crypto.randomUUID(),reason:'Invalid reserved debit',lines:[{item_id:item,owner_id:owner,location_id:location,quantity:'-3'}]};
 expect((await call(`/companies/${ids.a}/inventory/corrections`,t,'POST',debit)).status).toBe(409);
 await asUser(db,ids.adminA,ids.a,async()=>{await db.query("update app.items set name='Renamed',active=false,version=version+1 where id=$1",[item]);});
 expect((await(await call(path()+'/'+reservation.id,t)).json()).snapshot.item.name).toBe('Material');
 const body={idempotency_key:crypto.randomUUID(),reason:'Customer cancelled'};
 const released=await call(path()+'/'+reservation.id+'/release',t,'POST',body);expect(released.status).toBe(201);const row=await released.json();expect(row.active).toBe(false);expect(row.events).toHaveLength(2);
 expect((await call(path()+'/'+reservation.id+'/release',t,'POST',body)).status).toBe(201);
 expect((await call(path()+'/'+reservation.id+'/release',t,'POST',{...body,idempotency_key:crypto.randomUUID()})).status).toBe(409);
 const balance=(await db.query<any>('select quantity,reserved_quantity from app.stock_balances')).rows[0];expect(balance.quantity).toBe('10.00825001');expect(balance.reserved_quantity).toBe('0.00000000');
 await expect(db.exec("update app.reservation_events set reason='Rewrite history'")).rejects.toMatchObject({code:'23514'});
});
it('read-only membership can read reservations but cannot reserve or release',async()=>{
 await db.query("insert into app.role_permissions values($1,$2,'inventory.read')",[ids.a,ids.readRole]);
 const t=token(ids.reader,ids.sessionRead);expect((await call(path(),t)).status).toBe(200);expect((await call(path()+'/'+reservation.id,t)).status).toBe(200);
 expect((await call(path()+'/'+reservation.id+'/release',t,'POST',{idempotency_key:crypto.randomUUID(),reason:'Forbidden release'})).status).toBe(403);
});
