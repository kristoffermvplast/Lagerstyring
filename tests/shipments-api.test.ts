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

const path=(company=ids.a)=>`/companies/${company}/shipments`;
let item:string,owner:string,location:string,customer:string;let shipment:any;
const key=()=>crypto.randomUUID();
const t=()=>token(ids.adminA,ids.session);
async function act(action:string,row=shipment){const r=await call(path()+'/'+row.id+'/'+action,t(),'POST',{idempotency_key:key(),version:row.version,reason:'Shipment test command'});expect(r.status).toBe(201);return r.json();}
async function create(quantity='8.00825001'){const r=await call(path(),t(),'POST',{idempotency_key:key(),version:0,reason:'Create shipment',data:{code:key(),customer_id:customer,ship_date:'2026-09-16',lines:[{item_id:item,owner_id:owner,location_id:location,quantity}]}});expect(r.status).toBe(201);return r.json();}
it('creates historical draft with exact amounts without changing stock; enforces state and version',async()=>{
 await asUser(db,ids.adminA,ids.a,async()=>{
 const unit=(await db.query<any>("insert into app.units(company_id,code,name,symbol,dimension) values($1,'KG','Kilogram','kg','mass') returning id",[ids.a])).rows[0].id;
 item=(await db.query<any>("insert into app.items(company_id,kind,code,name,unit_id) values($1,'material','M','Material',$2) returning id",[ids.a,unit])).rows[0].id;
 owner=(await db.query<any>("insert into app.stock_owners(company_id,code,name,kind) values($1,'OWN','Owner','company') returning id",[ids.a])).rows[0].id;
 location=(await db.query<any>("insert into app.locations(company_id,code,name) values($1,'L','Location') returning id",[ids.a])).rows[0].id;
 customer=(await db.query<any>("insert into app.customers(company_id,code,name) values($1,'C','Customer') returning id",[ids.a])).rows[0].id;
 await db.query("insert into app.inventory_entries(company_id,idempotency_key,kind,reason,request) values($1,$2,'correction','Opening stock',$3)",[ids.a,key(),JSON.stringify([{item_id:item,owner_id:owner,location_id:location,quantity:'10.00825001'}])]);
 });
 shipment=await create();expect(shipment.status).toBe('draft');
 expect((await call(path()+'/'+shipment.id+'/dispatch',t(),'POST',{idempotency_key:key(),version:shipment.version,reason:'Skip steps'})).status).toBe(409);
 shipment=await act('plan');
 expect((await call(path()+'/'+shipment.id+'/reserve',t(),'POST',{idempotency_key:key(),version:1,reason:'Stale version'})).status).toBe(409);
 expect((await db.query<any>('select reserved_quantity from app.stock_balances')).rows[0].reserved_quantity).toBe('0.00000000');
});
it('reserves atomically, blocks separate release and rolls back overreservation',async()=>{
 shipment=await act('reserve');
 const d=await(await call(path()+'/'+shipment.id,t())).json();expect(d.reservations).toHaveLength(1);
 const release=await call(`/companies/${ids.a}/reservations/${d.reservations[0].reservation_id}/release`,t(),'POST',{idempotency_key:key(),reason:'Illegal independent release'});expect(release.status).toBe(409);
 const second=await act('plan',await create('3'));
 expect((await call(path()+'/'+second.id+'/reserve',t(),'POST',{idempotency_key:key(),version:second.version,reason:'Overreservation'})).status).toBe(409);
 expect((await(await call(path()+'/'+second.id,t())).json()).status).toBe('planned');
 expect((await db.query<any>('select quantity,reserved_quantity from app.stock_balances')).rows[0]).toEqual({quantity:'10.00825001',reserved_quantity:'8.00825001'});
});
it('dispatch retries debit once, preserve snapshots, and reject cancellation or generic reversal afterwards',async()=>{
 await asUser(db,ids.adminA,ids.a,()=>db.query("update app.customers set name='Renamed',version=version+1 where id=$1",[customer]));
 shipment=await act('ready');const body={idempotency_key:key(),version:shipment.version,reason:'Confirmed dispatched'};
 const r=await call(path()+'/'+shipment.id+'/dispatch',t(),'POST',body);expect(r.status).toBe(201);shipment=await r.json();expect(shipment.status).toBe('dispatched');expect(shipment.snapshot.customer.name).toBe('Customer');
 expect(await(await call(path()+'/'+shipment.id+'/dispatch',t(),'POST',body)).json()).toEqual(shipment);
 expect((await call(path()+'/'+shipment.id+'/dispatch',t(),'POST',{...body,reason:'Changed retry'})).status).toBe(409);
 expect((await call(path()+'/'+shipment.id+'/cancel',t(),'POST',{...body,idempotency_key:key(),version:shipment.version})).status).toBe(409);
 expect((await call(`/companies/${ids.a}/inventory/entries/${shipment.entry_id}/reverse`,t(),'POST',{idempotency_key:key(),reason:'Invalid shipment reversal'})).status).toBe(409);
 expect((await db.query<any>('select quantity,reserved_quantity from app.stock_balances')).rows[0]).toEqual({quantity:'2.00000000',reserved_quantity:'0.00000000'});
 expect((await db.query<any>("select count(*)::int n from app.inventory_entries where kind='shipment'")).rows[0].n).toBe(1);
});
it('cancellation releases only reservation and does not debit physical stock',async()=>{
 const row=await act('reserve',await act('plan',await create('1')));const result=await act('cancel',row);expect(result.status).toBe('cancelled');
 expect((await db.query<any>('select quantity,reserved_quantity from app.stock_balances')).rows[0]).toEqual({quantity:'2.00000000',reserved_quantity:'0.00000000'});
});
it('denies unauthorized, cross-company, unknown IDs, direct projections and immutable history edits',async()=>{
 const other=token(ids.adminB,ids.sessionB);
 for(const route of [path(),path()+'/'+shipment.id])expect((await call(route)).status).toBe(401);
 expect((await call(path(ids.b),t())).status).toBe(403);
 expect((await call(path(ids.b)+'/'+shipment.id,other)).status).toBe(404);
 expect((await call(path()+'/'+key(),t())).status).toBe(404);
 expect((await call(path(ids.b)+'/'+shipment.id+'/cancel',other,'POST',{idempotency_key:key(),version:shipment.version,reason:'Foreign mutation'})).status).toBe(404);
 for(const sql of ["update app.shipments set status='draft'",'delete from app.shipment_events','delete from app.shipment_reservations','select app_private.command_shipment()'])await expect(asUser(db,ids.adminA,ids.a,()=>db.exec(sql))).rejects.toMatchObject({code:'42501'});
 await expect(db.exec("update app.shipment_events set reason='Rewrite history'")).rejects.toMatchObject({code:'23514'});
 await db.query("insert into app.role_permissions values($1,$2,'shipments.read')",[ids.a,ids.readRole]);const reader=token(ids.reader,ids.sessionRead);
 expect((await call(path(),reader)).status).toBe(200);expect((await call(path()+'/'+shipment.id+'/dispatch',reader,'POST',{idempotency_key:key(),version:shipment.version,reason:'Unauthorized dispatch'})).status).toBe(403);
});

it('rolls back every line if one reservation fails and preserves draft creation idempotency',async()=>{
 const body={idempotency_key:key(),version:0,reason:'Atomic lines test',data:{code:'MULTI-ROLLBACK',customer_id:customer,ship_date:'2026-09-16',lines:[{item_id:item,owner_id:owner,location_id:location,quantity:'1'},{item_id:item,owner_id:owner,location_id:location,quantity:'2'}]}};
 const result=await call(path(),t(),'POST',body);expect(result.status).toBe(201);let row=await result.json();expect(await(await call(path(),t(),'POST',body)).json()).toEqual(row);
 expect((await call(path(),t(),'POST',{...body,data:{...body.data,code:'CHANGED'}})).status).toBe(409);
 row=await act('plan',row);expect((await call(path()+'/'+row.id+'/reserve',t(),'POST',{idempotency_key:key(),version:row.version,reason:'One line exceeds stock'})).status).toBe(409);
 expect((await db.query<any>('select count(*)::int n from app.shipment_reservations where shipment_id=$1',[row.id])).rows[0].n).toBe(0);
 expect((await db.query<any>('select reserved_quantity from app.stock_balances')).rows[0].reserved_quantity).toBe('0.00000000');
});
it('snapshots draft edits with optimistic concurrency and keeps database/browser boundaries closed',async()=>{
 const original=await create('1');const data={code:'EDITED',customer_id:customer,ship_date:'2026-09-20',carrier:'Truck',lines:[{item_id:item,owner_id:owner,location_id:location,quantity:'1'}]};
 const body={idempotency_key:key(),version:original.version,reason:'Change shipment plan',data};const response=await call(path()+'/'+original.id+'/edit',t(),'POST',body);expect(response.status).toBe(201);const edited=await response.json();expect(edited.version).toBe(2);
 expect((await call(path()+'/'+original.id+'/edit',t(),'POST',{...body,idempotency_key:key()})).status).toBe(409);
 expect((await db.query<any>("select result->>'code' code from app.shipment_events where shipment_id=$1 order by created_at",[original.id])).rows.map(r=>r.code)).toEqual([original.code,'EDITED']);
 const privileges=(await db.query<any>("select has_table_privilege('anon','app.shipments','SELECT') a,has_table_privilege('authenticated','app.shipments','INSERT') b,has_function_privilege('app_backend','app_private.command_shipment()','EXECUTE') c")).rows[0];expect(privileges).toEqual({a:false,b:false,c:false});
 await expect(asUser(db,ids.adminA,ids.a,()=>db.query("insert into app.inventory_entries(company_id,idempotency_key,kind,reason,request) values($1,$2,'shipment','Forged shipment','[]')",[ids.a,key()]))).rejects.toMatchObject({code:'42501'});
 const planned=await act('plan',edited);expect((await call(path()+'/'+planned.id+'/edit',t(),'POST',{...body,version:planned.version,idempotency_key:key()})).status).toBe(409);
});
