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

const path=(company=ids.a)=>`/companies/${company}/receipts`;
let item:string,owner:string,location:string,supplier:string,entry:any;
const body=()=>({idempotency_key:crypto.randomUUID(),item_id:item,owner_id:owner,location_id:location,quantity:'8.00000001',expected_quantity:'10.00825001',supplier_id:supplier,pallet_count:1,reference:'Delivery A',comment:'Partial delivery'});
beforeAll(async()=>{await asUser(db,ids.adminA,ids.a,async()=>{
 const unit=(await db.query<any>("insert into app.units(company_id,code,name,symbol,dimension) values($1,'KG','Kilogram','kg','mass') returning id",[ids.a])).rows[0].id;
 item=(await db.query<any>("insert into app.items(company_id,kind,code,name,unit_id) values($1,'material','M','Material',$2) returning id",[ids.a,unit])).rows[0].id;
 owner=(await db.query<any>("insert into app.stock_owners(company_id,code,name,kind) values($1,'OWN','External stock','other') returning id",[ids.a])).rows[0].id;
 location=(await db.query<any>("insert into app.locations(company_id,code,name) values($1,'L','Location') returning id",[ids.a])).rows[0].id;
 supplier=(await db.query<any>("insert into app.suppliers(company_id,code,name) values($1,'SUP','Supplier') returning id",[ids.a])).rows[0].id;
 });await db.query("insert into app.role_permissions values($1,$2,'inventory.read'),($1,$2,'inventory.receive')",[ids.a,ids.readRole]);});
it('a receiving-only user posts a receipt with exact difference and replays it once',async()=>{
 const t=token(ids.reader,ids.sessionRead),input=body();const response=await call(path(),t,'POST',input);expect(response.status).toBe(201);entry=await response.json();
 expect(entry.quantity).toBe('8.00000001');expect(entry.difference).toBe('-2.00825000');expect(entry.actor_id).toBe(ids.reader);expect(entry.supplier_snapshot.name).toBe('Supplier');expect(entry.pallet_count).toBe(1);expect(entry.received_at).toBe(entry.posted_at);
 expect((await(await call(path(),t,'POST',input)).json()).id).toBe(entry.id);
 expect((await call(path(),t,'POST',{...input,expected_quantity:'11'})).status).toBe(409);
 expect((await(await call(`/companies/${ids.a}/inventory/balances`,t)).json()).items[0].quantity).toBe('8.00000001');
 const correction={idempotency_key:crypto.randomUUID(),reason:'Not allowed',lines:[{item_id:item,owner_id:owner,location_id:location,quantity:'1'}]};
 expect((await call(`/companies/${ids.a}/inventory/corrections`,t,'POST',correction)).status).toBe(403);
 expect((await call(`/companies/${ids.a}/inventory/entries/${entry.id}/reverse`,t,'POST',{idempotency_key:crypto.randomUUID(),reason:'Not allowed'})).status).toBe(403);
});
it('reads receipts, preserves supplier snapshot and represents unknown expectation as null',async()=>{
 const t=token(ids.adminA,ids.session);
 await asUser(db,ids.adminA,ids.a,()=>db.query("update app.suppliers set name='Renamed supplier',version=version+1 where id=$1",[supplier]));
 expect((await(await call(path()+'/'+entry.id,t)).json()).supplier_snapshot.name).toBe('Supplier');
 const r=await call(path(),t,'POST',{...body(),expected_quantity:null,supplier_id:null,pallet_count:null});expect(r.status).toBe(201);const unknown=await r.json();expect(unknown.difference).toBeNull();expect(unknown.expected_quantity).toBeNull();expect(unknown.supplier_snapshot).toBeNull();
 expect((await(await call(path()+'?supplier_id='+supplier,t)).json()).total).toBe(1);
 expect((await(await call(path()+'?q=Delivery&limit=1&page=2',t)).json()).items).toHaveLength(1);
 expect((await call(path()+'/'+crypto.randomUUID(),t)).status).toBe(404);
});
it('allows compensating reversal of a receipt exactly once, retaining the original receipt',async()=>{
 const t=token(ids.adminA,ids.session),url=`/companies/${ids.a}/inventory/entries/${entry.id}/reverse`;
 const response=await call(url,t,'POST',{idempotency_key:crypto.randomUUID(),reason:'Incorrect receipt'});expect(response.status).toBe(201);const reversed=await response.json();
 const original=await(await call(path()+'/'+entry.id,t)).json();expect(original.reversal_id).toBe(reversed.id);expect(original.quantity).toBe('8.00000001');
 expect((await call(url,t,'POST',{idempotency_key:crypto.randomUUID(),reason:'Duplicate reversal'})).status).toBe(409);
 expect((await call(path()+'/'+reversed.id,t)).status).toBe(404);
});
it('rejects invalid quantities, forged metadata, inactive suppliers and foreign references atomically',async()=>{
 const t=token(ids.adminA,ids.session),before=(await db.query<any>('select count(*)::int n from app.inventory_entries')).rows[0].n;
 for(const input of [{quantity:'0'},{quantity:'-1'},{quantity:1},{quantity:'0.000000001'},{expected_quantity:'-1'},{expected_quantity:'1.000000001'},{pallet_count:1.5},{pallet_count:-1},{received_at:'2026-01-01'},{company_id:ids.b}])expect((await call(path(),t,'POST',{...body(),...input})).status).toBe(400);
 expect((await call(path(),t,'POST',{...body(),supplier_id:crypto.randomUUID()})).status).toBe(409);
 await asUser(db,ids.adminA,ids.a,()=>db.query('update app.suppliers set active=false,version=version+1 where id=$1',[supplier]));
 expect((await call(path(),t,'POST',body())).status).toBe(409);
 const other=token(ids.adminB,ids.sessionB);expect((await call(path(ids.b),other,'POST',body())).status).toBe(409);
 expect((await db.query<any>('select count(*)::int n from app.inventory_entries')).rows[0].n).toBe(before);
});
it('enforces public auth, company isolation, read-only access and receipt permission separately',async()=>{
 const own=token(ids.adminA,ids.session),other=token(ids.adminB,ids.sessionB),read=token(ids.reader,ids.sessionRead);
 expect((await call(path())).status).toBe(401);expect((await call(path(),other)).status).toBe(403);expect((await call(path(ids.b)+'/'+entry.id,other)).status).toBe(404);
 expect((await(await call(path(ids.b),other)).json()).items).toHaveLength(0);
 await db.query("delete from app.role_permissions where company_id=$1 and role_id=$2 and permission_code='inventory.receive'",[ids.a,ids.readRole]);
 expect((await call(path(),read)).status).toBe(200);expect((await call(path(),read,'POST',body())).status).toBe(403);
 expect((await call(path(),own,'POST',{...body(),idempotency_key:entry.idempotency_key,comment:'Changed'})).status).toBe(409);
});
it('database rejects receipt payload shape, precision, forged snapshots and metadata on corrections',async()=>{
 const line={item_id:item,owner_id:owner,location_id:location,quantity:'1'};
 const direct=(kind:string,lines:any[],expected:string|null)=>asUser(db,ids.adminA,ids.a,()=>db.query("insert into app.inventory_entries(company_id,idempotency_key,kind,reason,request,receipt_comment,receipt_expected_quantity) values($1,$2,$3,'Receipt test',$4,'',$5)",[ids.a,crypto.randomUUID(),kind,JSON.stringify(lines),expected]));
 for(const lines of [[],[line,line],[{...line,quantity:'-1'}]])await expect(direct('receipt',lines,null)).rejects.toMatchObject({code:'23514'});
 await expect(direct('receipt',[line],'1.000000001')).rejects.toMatchObject({code:'23514'});
 await expect(direct('correction',[line],null)).rejects.toMatchObject({code:'23514'});
 await expect(asUser(db,ids.adminA,ids.a,()=>db.exec("insert into app.inventory_entries(receipt_supplier_snapshot) values('{}')"))).rejects.toMatchObject({code:'42501'});
});
it('requires whole expected counts and blocks reversal after received stock was consumed',async()=>{
 const t=token(ids.adminA,ids.session);
 const countItem=await asUser(db,ids.adminA,ids.a,async()=>{
  const u=(await db.query<any>("insert into app.units(company_id,code,name,symbol,dimension) values($1,'PCS','Pieces','stk','count') returning id",[ids.a])).rows[0].id;
  return(await db.query<any>("insert into app.items(company_id,kind,code,name,unit_id) values($1,'product','P','Product',$2) returning id",[ids.a,u])).rows[0].id;
 });
 const input={...body(),item_id:countItem,supplier_id:null,quantity:'2',expected_quantity:'1.5'};
 expect((await call(path(),t,'POST',input)).status).toBe(409);
 const r=await call(path(),t,'POST',{...input,expected_quantity:'0'});expect(r.status).toBe(201);const received=await r.json();expect(received.difference).toBe('2.00000000');
 expect((await call(`/companies/${ids.a}/inventory/corrections`,t,'POST',{idempotency_key:crypto.randomUUID(),reason:'Consumed locally',lines:[{item_id:countItem,owner_id:owner,location_id:location,quantity:'-2'}]})).status).toBe(201);
 expect((await call(`/companies/${ids.a}/inventory/entries/${received.id}/reverse`,t,'POST',{idempotency_key:crypto.randomUUID(),reason:'Already consumed'})).status).toBe(409);
 expect((await(await call(path()+'/'+received.id,t)).json()).reversal_id).toBeNull();
});
