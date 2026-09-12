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

const path=(company=ids.a)=>`/companies/${company}/transfers`;
let item:string,owner:string,location:string,target:string,entry:any;
const body=()=>({idempotency_key:crypto.randomUUID(),item_id:item,owner_id:owner,from_location_id:location,to_location_id:target,quantity:'8.00000001',reference:'Transfer A',comment:'Local move'});
beforeAll(async()=>{await asUser(db,ids.adminA,ids.a,async()=>{
 const unit=(await db.query<any>("insert into app.units(company_id,code,name,symbol,dimension) values($1,'KG','Kilogram','kg','mass') returning id",[ids.a])).rows[0].id;
 item=(await db.query<any>("insert into app.items(company_id,kind,code,name,unit_id) values($1,'material','M','Material',$2) returning id",[ids.a,unit])).rows[0].id;
 owner=(await db.query<any>("insert into app.stock_owners(company_id,code,name,kind) values($1,'OWN','External stock','other') returning id",[ids.a])).rows[0].id;
 location=(await db.query<any>("insert into app.locations(company_id,code,name) values($1,'L','Source') returning id",[ids.a])).rows[0].id;
 target=(await db.query<any>("insert into app.locations(company_id,code,name) values($1,'T','Target') returning id",[ids.a])).rows[0].id;
 await db.query("insert into app.inventory_entries(company_id,idempotency_key,kind,reason,request) values($1,$2,'correction','Opening local stock',$3)",[ids.a,crypto.randomUUID(),JSON.stringify([{item_id:item,owner_id:owner,location_id:location,quantity:'10'}])]);
 });await db.query("insert into app.role_permissions values($1,$2,'inventory.read'),($1,$2,'inventory.transfer')",[ids.a,ids.readRole]);});
it('transfer-only user moves stock atomically with ownership, precision and idempotency',async()=>{
 const t=token(ids.reader,ids.sessionRead),input=body(),r=await call(path(),t,'POST',input);expect(r.status).toBe(201);entry=await r.json();
 expect(entry.kind).toBe('transfer');expect(entry.actor_id).toBe(ids.reader);expect(entry.lines.map((l:any)=>l.quantity)).toEqual(['-8.00000001','8.00000001']);expect(entry.lines.every((l:any)=>l.owner_id===owner&&l.company_id===ids.a)).toBe(true);
 expect((await(await call(path(),t,'POST',input)).json()).id).toBe(entry.id);expect((await call(path(),t,'POST',{...input,quantity:'1'})).status).toBe(409);
 expect((await db.query<any>('select sum(quantity)::text n from app.stock_balances')).rows[0].n).toBe('10.00000000');
 expect((await db.query<any>('select quantity from app.stock_balances where location_id=$1',[location])).rows[0].quantity).toBe('1.99999999');
 expect((await call(`/companies/${ids.a}/inventory/entries/${entry.id}/reverse`,t,'POST',{idempotency_key:crypto.randomUUID(),reason:'Not authorized'})).status).toBe(403);
});
it('preserves historical location names and permits a single compensating reversal',async()=>{
 const t=token(ids.adminA,ids.session);await asUser(db,ids.adminA,ids.a,()=>db.query("update app.locations set name='Renamed',version=version+1 where id=$1",[location]));
 expect((await(await call(path()+'/'+entry.id,t)).json()).lines[0].snapshot.location.name).toBe('Source');
 const u=`/companies/${ids.a}/inventory/entries/${entry.id}/reverse`,b={idempotency_key:crypto.randomUUID(),reason:'Incorrect move'};
 expect((await call(u,t,'POST',b)).status).toBe(201);expect((await call(u,t,'POST',{...b,idempotency_key:crypto.randomUUID()})).status).toBe(409);
 expect((await db.query<any>('select quantity from app.stock_balances where location_id=$1',[location])).rows[0].quantity).toBe('10.00000000');
 expect((await(await call(path()+'?q=Transfer&limit=1',t)).json()).total).toBe(1);
});
it('rejects same location, invalid input, insufficient stock and foreign references without partial posting',async()=>{
 const t=token(ids.adminA,ids.session),before=(await db.query<any>('select count(*)::int n from app.inventory_entries')).rows[0].n;
 for(const x of [{to_location_id:location},{quantity:'0'},{quantity:'-1'},{quantity:1},{quantity:'0.000000001'},{company_id:ids.b},{unit_id:crypto.randomUUID()}])expect((await call(path(),t,'POST',{...body(),...x})).status).toBe(400);
 for(const x of [{quantity:'11'},{to_location_id:crypto.randomUUID()},{owner_id:crypto.randomUUID()},{item_id:crypto.randomUUID()}])expect((await call(path(),t,'POST',{...body(),...x})).status).toBe(409);
 const other=token(ids.adminB,ids.sessionB);expect((await call(path(ids.b),other,'POST',body())).status).toBe(409);
 await asUser(db,ids.adminA,ids.a,()=>db.query('update app.locations set is_storage=false,version=version+1 where id=$1',[target]));
 expect((await call(path(),t,'POST',body())).status).toBe(409);
 await asUser(db,ids.adminA,ids.a,()=>db.query('update app.locations set is_storage=true,version=version+1 where id=$1',[target]));
 expect((await db.query<any>('select count(*)::int n from app.inventory_entries')).rows[0].n).toBe(before);
 expect((await db.query<any>('select quantity from app.stock_balances where location_id=$1',[target])).rows[0].quantity).toBe('0.00000000');
});
it('requires auth and explicit transfer permission and isolates lists and details',async()=>{
 const t=token(ids.adminA,ids.session),other=token(ids.adminB,ids.sessionB),reader=token(ids.reader,ids.sessionRead);
 expect((await call(path())).status).toBe(401);expect((await call(path(),other)).status).toBe(403);expect((await call(path(ids.b)+'/'+entry.id,other)).status).toBe(404);expect((await(await call(path(ids.b),other)).json()).items).toHaveLength(0);expect((await call(path()+'/'+crypto.randomUUID(),t)).status).toBe(404);
 await db.query("delete from app.role_permissions where company_id=$1 and role_id=$2 and permission_code='inventory.transfer'",[ids.a,ids.readRole]);expect((await call(path(),reader)).status).toBe(200);expect((await call(path(),reader,'POST',body())).status).toBe(403);
});
it('database enforces balanced two-line transfers and denies journal mutation',async()=>{
 const a={item_id:item,owner_id:owner,location_id:location,quantity:'-1'},b={...a,location_id:target,quantity:'1'};
 for(const lines of [[a],[a,b,b],[a,{...b,quantity:'2'}],[a,{...b,owner_id:crypto.randomUUID()}],[a,{...b,item_id:crypto.randomUUID()}],[a,{...b,location_id:location}]])await expect(asUser(db,ids.adminA,ids.a,()=>db.query("insert into app.inventory_entries(company_id,idempotency_key,kind,reason,request) values($1,$2,'transfer','Invalid move',$3)",[ids.a,crypto.randomUUID(),JSON.stringify(lines)]))).rejects.toMatchObject({code:'23514'});
 await expect(asUser(db,ids.adminA,ids.a,()=>db.query("update app.inventory_entries set reason='Forged' where id=$1",[entry.id]))).rejects.toMatchObject({code:'42501'});
});
