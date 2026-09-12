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

const path=(company=ids.a)=>`/companies/${company}/inventory`;
let item:string,location:string,owner:any,entry:any;
it('creates owner and posts an exact correction; same key is replayed once',async()=>{
 await asUser(db,ids.adminA,ids.a,async()=>{
 const unit=(await db.query<any>("insert into app.units(company_id,code,name,symbol,dimension) values($1,'KG','Kilogram','kg','mass') returning id",[ids.a])).rows[0].id;
 item=(await db.query<any>("insert into app.items(company_id,kind,code,name,unit_id) values($1,'material','M','Material',$2) returning id",[ids.a,unit])).rows[0].id;
 location=(await db.query<any>("insert into app.locations(company_id,code,name) values($1,'L','Location') returning id",[ids.a])).rows[0].id;
 });
 const t=token(ids.adminA,ids.session);
 const created=await call(path()+'/owners',t,'POST',{code:'OWN',name:'Company stock',kind:'company'});expect(created.status).toBe(201);owner=await created.json();
 const body={idempotency_key:crypto.randomUUID(),reason:'Opening count',lines:[{item_id:item,owner_id:owner.id,location_id:location,quantity:'10.00825001'}]};
 const posted=await call(path()+'/corrections',t,'POST',body);expect(posted.status).toBe(201);entry=await posted.json();expect(entry.lines[0].quantity).toBe('10.00825001');
 expect((await(await call(path()+'/corrections',t,'POST',body)).json()).id).toBe(entry.id);
 expect((await call(path()+'/corrections',t,'POST',{...body,reason:'Changed request'})).status).toBe(409);
 expect((await(await call(path()+'/balances',t)).json()).items[0].quantity).toBe('10.00825001');
 expect((await(await call(path()+'/entries',t)).json()).total).toBe(1);
 expect((await call(path()+'/corrections',t,'POST',{...body,idempotency_key:crypto.randomUUID(),lines:[{...body.lines[0],quantity:'-11'}]})).status).toBe(409);
});
it('rejects malformed payloads, enforces owner versions, history and complete reversal',async()=>{
 const t=token(ids.adminA,ids.session);
 expect((await call(path()+'/owners/'+owner.id,t,'PATCH',{version:owner.version,data:{code:'OWN',name:'Renamed',active:true}})).status).toBe(200);
 expect((await call(path()+'/owners/'+owner.id,t,'PATCH',{version:owner.version,data:{code:'OWN',name:'Stale',active:true}})).status).toBe(409);
 expect((await(await call(path()+'/owners/'+owner.id+'/history',t)).json())).toHaveLength(2);
 expect((await call(path()+'/corrections',t,'POST',{idempotency_key:crypto.randomUUID(),reason:'Bad input',lines:[{item_id:item,owner_id:owner.id,location_id:location,quantity:5}]})).status).toBe(400);
 const body={idempotency_key:crypto.randomUUID(),reason:'Reverse count'};
 const reversed=await call(path()+'/entries/'+entry.id+'/reverse',t,'POST',body);expect(reversed.status).toBe(201);
 const id=(await reversed.json()).id;expect((await(await call(path()+'/entries/'+entry.id+'/reverse',t,'POST',body)).json()).id).toBe(id);
 expect((await call(path()+'/entries/'+entry.id+'/reverse',t,'POST',{...body,idempotency_key:crypto.randomUUID()})).status).toBe(409);
 expect((await(await call(path()+'/balances',t)).json()).items[0].quantity).toBe('0.00000000');
});
it('denies unauthenticated, unauthorized and foreign company requests without leaking records',async()=>{
 const own=token(ids.adminA,ids.session),other=token(ids.adminB,ids.sessionB),reader=token(ids.reader,ids.sessionRead);
 for(const route of ['/balances','/entries','/owners']){expect((await call(path()+route)).status).toBe(401);expect((await call(path()+route,other)).status).toBe(403);expect((await call(path()+route,reader)).status).toBe(403);}
 await db.query("insert into app.role_permissions values($1,$2,'inventory.read')",[ids.a,ids.readRole]);
 expect((await call(path()+'/balances',reader)).status).toBe(200);
 expect((await call(path()+'/owners',reader,'POST',{code:'X',name:'Forbidden',kind:'other'})).status).toBe(403);
 expect((await call(path(ids.b)+'/entries/'+entry.id,other)).status).toBe(404);
 expect((await call(path(ids.b)+'/owners/'+owner.id+'/history',other)).status).toBe(404);
 expect((await(await call(path(ids.b)+'/balances',other)).json()).total).toBe(0);
 expect((await call(path()+'/entries/'+crypto.randomUUID(),own)).status).toBe(404);
});
