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

const path=(company=ids.a)=>`/companies/${company}/pallet-accounts`;
const key=()=>crypto.randomUUID(),t=()=>token(ids.adminA,ids.session);
let type:string,customer:string,supplier:string,first:any;
const payload=(action='outbound',quantity='12')=>({idempotency_key:key(),action,reason:'Pallet test movement',data:{customer_id:customer,supplier_id:null as string|null,pallet_type_id:type,quantity,occurred_on:'2026-09-15',reference:'Pallet test'}});
async function post(body:any){return call(path()+'/movements',t(),'POST',body);}
async function totals(){return(await(await call(path()+'/balances',t())).json()).items;}
it('books exact signed debts without touching physical stock and snapshots master data',async()=>{
 await asUser(db,ids.adminA,ids.a,async()=>{
 type=(await db.query<any>("insert into app.pallet_types(company_id,code,name) values($1,'T','Reusable type') returning id",[ids.a])).rows[0].id;
 customer=(await db.query<any>("insert into app.customers(company_id,code,name) values($1,'C','Customer') returning id",[ids.a])).rows[0].id;
 supplier=(await db.query<any>("insert into app.suppliers(company_id,code,name) values($1,'S','Supplier') returning id",[ids.a])).rows[0].id;
 });
 const c=payload();const a=await post(c);expect(a.status).toBe(201);first=await a.json();expect(first.quantity).toBe('12');
 expect((await(await post(c)).json()).id).toBe(first.id);expect((await post({...c,data:{...c.data,quantity:'13'}})).status).toBe(409);
 expect((await post(payload('inbound','15'))).status).toBe(201);expect((await totals())[0].quantity).toBe('-3');
 expect((await db.query<any>('select count(*)::int n from app.inventory_entries')).rows[0].n).toBe(0);
 await asUser(db,ids.adminA,ids.a,async()=>{await db.query("update app.pallet_types set name='Renamed',version=version+1 where id=$1",[type]);});
 expect((await(await call(path()+'/entries/'+first.id,t())).json()).snapshot.type.name).toBe('Reusable type');
 const supply=payload('inbound','7');supply.data.customer_id=null as any;supply.data.supplier_id=supplier;expect((await post(supply)).status).toBe(201);
 expect((await totals()).find((x:any)=>x.supplier_id===supplier).quantity).toBe('-7');
});
it('requires integer counts and exact party selection; filters as-of balances correctly',async()=>{
 for(const q of ['0','1.5','1e3','1000000000','-1'])expect((await post(payload('outbound',q))).status).toBe(400);
 const both=payload();both.data.supplier_id=supplier;expect((await post(both)).status).toBe(400);
 const c=payload('correction','-5');c.data.occurred_on='2026-09-16';expect((await post(c)).status).toBe(201);
 const before=await(await call(path()+'/balances?to=2026-09-15&customer_id='+customer,t())).json();expect(before.items[0].quantity).toBe('-3');
 expect((await call(path()+'/balances?from=2026-09-01',t())).status).toBe(400);
 expect((await(await call(path()+'/entries?from=2026-09-16&to=2026-09-16',t())).json()).total).toBe(1);
});
it('reverses once with exact historical values, audit and no direct write privileges',async()=>{
 const c={idempotency_key:key(),reason:'Reverse wrong movement'};
 const r=await call(path()+'/entries/'+first.id+'/reverse',t(),'POST',c);expect(r.status).toBe(201);const reversed=await r.json();expect(reversed.quantity).toBe('-12');expect(reversed.reverses_id).toBe(first.id);
 expect((await call(path()+'/entries/'+first.id+'/reverse',t(),'POST',c)).status).toBe(201);
 expect((await call(path()+'/entries/'+first.id+'/reverse',t(),'POST',{...c,idempotency_key:key()})).status).toBe(409);
 expect((await call(path()+'/entries/'+reversed.id+'/reverse',t(),'POST',{...c,idempotency_key:key()})).status).toBe(409);
 for(const sql of ['delete from app.pallet_entries','update app.pallet_entries set quantity=1','delete from app.pallet_events','update app.shipments set pallet_exchange=\'[]\''])await expect(asUser(db,ids.adminA,ids.a,()=>db.exec(sql))).rejects.toBeDefined();
 const grants=(await db.query<any>("select has_table_privilege('anon','app.pallet_entries','SELECT') a,has_table_privilege('authenticated','app.pallet_events','SELECT') b,has_function_privilege('app_runtime','app_private.command_pallet()','EXECUTE') c")).rows[0];expect(grants).toEqual({a:false,b:false,c:false});
});
it('isolates tenants and read-only permissions including foreign references',async()=>{
 expect((await call(path()+'/entries')).status).toBe(401);
 expect((await call(path(ids.b)+'/balances',t())).status).toBe(403);
 expect((await call(path()+'/entries/'+key(),t())).status).toBe(404);
 const other=await asUser(db,ids.adminB,ids.b,async()=>(await db.query<any>("insert into app.pallet_types(company_id,code,name) values($1,'T','Foreign') returning id",[ids.b])).rows[0].id,ids.sessionB);
 const c=payload();c.data.pallet_type_id=other;expect((await post(c)).status).toBe(409);
 await db.query("insert into app.role_permissions values($1,$2,'pallets.read')",[ids.a,ids.readRole]);
 const read=token(ids.reader,ids.sessionRead);expect((await call(path()+'/balances',read)).status).toBe(200);expect((await call(path()+'/movements',read,'POST',payload())).status).toBe(403);
 expect((await call(path()+'/entries/'+first.id+'/reverse',read,'POST',{idempotency_key:key(),reason:'Forbidden correction'})).status).toBe(403);
 expect(await asUser(db,ids.adminB,ids.b,async()=>(await db.query('select * from app.pallet_entries')).rows,ids.sessionB)).toEqual([]);
});
it('rejects forged database commands, inactive references ',async()=>{
 for(const request of [{...payload().data,quantity:'1.1'},{...payload().data,customer_id:ids.b},{...payload().data,extra:true}])await expect(asUser(db,ids.adminA,ids.a,()=>db.query("insert into app.pallet_events(company_id,idempotency_key,action,request,reason) values($1,$2,'outbound',$3,'Invalid direct command')",[ids.a,key(),JSON.stringify(request)]))).rejects.toBeDefined();
 await asUser(db,ids.adminA,ids.a,()=>db.query('update app.pallet_types set active=false,version=version+1 where id=$1',[type]));
 expect((await post(payload())).status).toBe(409);
 await asUser(db,ids.adminA,ids.a,()=>db.query('update app.pallet_types set active=true,version=version+1 where id=$1',[type]));
});
it('declares reusable packaging on a draft and books once atomically with dispatch; no extra stock debit',async()=>{
 let item='',owner='',location='';
 await asUser(db,ids.adminA,ids.a,async()=>{
 const unit=(await db.query<any>("insert into app.units(company_id,code,name,symbol,dimension) values($1,'KG','Kilogram','kg','mass') returning id",[ids.a])).rows[0].id;
 item=(await db.query<any>("insert into app.items(company_id,kind,code,name,unit_id) values($1,'material','M','Material',$2) returning id",[ids.a,unit])).rows[0].id;
 owner=(await db.query<any>("insert into app.stock_owners(company_id,code,name,kind) values($1,'OWN','Owner','company') returning id",[ids.a])).rows[0].id;
 location=(await db.query<any>("insert into app.locations(company_id,code,name) values($1,'L','Location') returning id",[ids.a])).rows[0].id;
 await db.query("insert into app.inventory_entries(company_id,idempotency_key,kind,reason,request) values($1,$2,'correction','Opening stock',$3)",[ids.a,key(),JSON.stringify([{item_id:item,owner_id:owner,location_id:location,quantity:'10'}])]);
 });
 const sp=`/companies/${ids.a}/shipments`;
 let s=await(await call(sp,t(),'POST',{idempotency_key:key(),version:0,reason:'Create shipment',data:{code:key(),customer_id:customer,ship_date:'2026-09-16',lines:[{item_id:item,owner_id:owner,location_id:location,quantity:'4'}]}})).json();
 const declaration={idempotency_key:key(),version:s.version,reason:'Actual returnable packaging',lines:[{pallet_type_id:type,quantity:'3'}]};
 expect((await call(path()+'/shipments/'+s.id,t(),'POST',declaration)).status).toBe(201);
 expect((await call(path()+'/shipments/'+s.id,t(),'POST',declaration)).status).toBe(201);
 expect((await call(path()+'/shipments/'+s.id,t(),'POST',{...declaration,idempotency_key:key()})).status).toBe(409);
 s=await(await call(sp+'/'+s.id,t())).json();expect(s.version).toBe(2);expect(s.pallet_exchange[0].quantity).toBe('3');
 const hist=await(await call(path()+'/shipments/'+s.id,t())).json();expect(hist.history).toHaveLength(1);
 for(const action of ['plan','reserve','ready']){const r=await call(sp+'/'+s.id+'/'+action,t(),'POST',{idempotency_key:key(),version:s.version,reason:'Prepare shipment'});expect(r.status).toBe(201);s=await r.json();}
 expect((await db.query<any>("select count(*)::int n from app.pallet_entries where kind='shipment'")).rows[0].n).toBe(0);
 const dispatch={idempotency_key:key(),version:s.version,reason:'Dispatch shipment'};
 const r=await call(sp+'/'+s.id+'/dispatch',t(),'POST',dispatch);expect(r.status).toBe(201);
 expect((await call(sp+'/'+s.id+'/dispatch',t(),'POST',dispatch)).status).toBe(201);
 const entries=(await db.query<any>("select * from app.pallet_entries where kind='shipment'")).rows;expect(entries).toHaveLength(1);expect(entries[0].quantity).toBe('3');expect(entries[0].customer_id).toBe(customer);
 expect((await db.query<any>('select quantity,reserved_quantity from app.stock_balances')).rows[0]).toEqual({quantity:'6.00000000',reserved_quantity:'0.00000000'});
 expect((await call(path()+'/shipments/'+s.id,t(),'POST',{...declaration,idempotency_key:key(),version:s.version})).status).toBe(409);
});
it('permission failure rolls back both shipment and debt; cancellation never books declared packaging',async()=>{
 const refs=(await db.query<any>("select b.item_id,b.owner_id,b.location_id from app.stock_balances b limit 1")).rows[0],sp=`/companies/${ids.a}/shipments`;
 let s=await(await call(sp,t(),'POST',{idempotency_key:key(),version:0,reason:'Create guarded shipment',data:{code:key(),customer_id:customer,ship_date:'2026-09-16',lines:[{...refs,quantity:'1'}]}})).json();
 expect((await call(path()+'/shipments/'+s.id,t(),'POST',{idempotency_key:key(),version:s.version,reason:'Declared packaging',lines:[{pallet_type_id:type,quantity:'2'},{pallet_type_id:type,quantity:'3'}]})).status).toBe(409);
 expect((await call(path()+'/shipments/'+s.id,t(),'POST',{idempotency_key:key(),version:s.version,reason:'Declared packaging',lines:[{pallet_type_id:type,quantity:'2'}]})).status).toBe(201);
 s=await(await call(sp+'/'+s.id,t())).json();
 for(const action of ['plan','reserve','ready'])s=await(await call(sp+'/'+s.id+'/'+action,t(),'POST',{idempotency_key:key(),version:s.version,reason:'Prepare guarded shipment'})).json();
 for(const p of ['shipments.read','shipments.dispatch','inventory.read','inventory.reserve'])await db.query('insert into app.role_permissions values($1,$2,$3)',[ids.a,ids.readRole,p]);
 const read=token(ids.reader,ids.sessionRead),before=(await db.query<any>('select quantity,reserved_quantity from app.stock_balances')).rows;
 expect((await call(sp+'/'+s.id+'/dispatch',read,'POST',{idempotency_key:key(),version:s.version,reason:'Missing pallet permission'})).status).toBe(403);
 expect((await(await call(sp+'/'+s.id,t())).json()).status).toBe('ready');expect((await db.query<any>('select quantity,reserved_quantity from app.stock_balances')).rows).toEqual(before);
 expect((await db.query('select * from app.pallet_entries where shipment_id=$1',[s.id])).rows).toHaveLength(0);
 expect((await call(sp+'/'+s.id+'/cancel',t(),'POST',{idempotency_key:key(),version:s.version,reason:'Cancel guarded shipment'})).status).toBe(201);
 expect((await db.query('select * from app.pallet_entries where shipment_id=$1',[s.id])).rows).toHaveLength(0);
});
