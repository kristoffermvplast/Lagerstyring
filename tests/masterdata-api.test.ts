import { createRequire } from 'node:module';
import { createServer, Server } from 'node:http';
import { AddressInfo } from 'node:net';
import { beforeAll,afterAll,it,expect,describe } from 'vitest';
import { fixture,ids } from './helpers/access-fixture';
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

const path=(company=ids.a,kind='customers')=>`/companies/${company}/masterdata/${kind}`;
let customer:any;
it('creates, lists, searches, edits, audits and deactivates via the real NestJS API',async()=>{
 const t=token(ids.adminA,ids.session);
 const created=await call(path(),t,'POST',{code:'API-1',name:'Customer % sample'});expect(created.status).toBe(201);customer=await created.json();
 const found=await call(path()+'?q=%25&sort=name',t);expect(found.status).toBe(200);expect((await found.json()).items).toHaveLength(1);
 const updated=await call(path()+'/'+customer.id,t,'PATCH',{version:1,data:{code:'API-1',name:'Changed',active:false}});expect(updated.status).toBe(200);
 expect((await (await call(path()+'?active=true',t)).json()).total).toBe(0);
 expect((await (await call(path()+'?active=false',t)).json()).total).toBe(1);
 const history=await (await call(path()+'/'+customer.id+'/history',t)).json();expect(history).toHaveLength(2);expect(history[0].before_value.name).toBe('Customer % sample');
 expect((await call(path()+'/'+customer.id,t,'PATCH',{version:1,data:{code:'API-1',name:'Stale'}})).status).toBe(409);
});
it('rejects cross-company reads, updates, history and injected fields or identifiers',async()=>{
 const t=token(ids.adminB,ids.sessionB);
 expect((await call(path(),t)).status).toBe(403);
 expect((await call(path(ids.b)+'/'+customer.id,t,'PATCH',{version:2,data:{code:'API-1',name:'Attack'}})).status).toBe(404);
 expect((await call(path(ids.b)+'/'+customer.id+'/history',t)).status).toBe(404);
 const own=token(ids.adminA,ids.session);
 expect((await call(path(),own,'POST',{code:'X',name:'X',company_id:ids.b})).status).toBe(400);
 expect((await call(path()+'?sort=company_id',own)).status).toBe(400);
 expect((await call(path(ids.a,'not_a_table'),own)).status).toBe(404);
});
it('validates contact details, lead times, references, unit dimensions and bounded paging',async()=>{
 const t=token(ids.adminA,ids.session);
 expect((await call(path(ids.a,'suppliers'),t,'POST',{code:'S',name:'Supplier',lead_time_days:-1})).status).toBe(400);
 expect((await call(path(),t,'POST',{code:'E',name:'Email',email:'invalid'})).status).toBe(400);
 expect((await call(path()+'?limit=101',t)).status).toBe(400);
 expect((await call(path(ids.a,'machines'),t,'POST',{code:'M',name:'Machine',machine_type_id:ids.roleB})).status).toBe(400);
 const u=await (await call(path(ids.a,'units'),t,'POST',{code:'U',name:'Mass unit',symbol:'u',dimension:'mass'})).json();
 expect((await call(path(ids.a,'units')+'/'+u.id,t,'PATCH',{version:1,data:{code:'U',name:'Unit',symbol:'u',dimension:'count'}})).status).toBe(400);
});
it('saves every catalog and rejects assignment of a foreign or inactive machine type',async()=>{
 const t=token(ids.adminA,ids.session),other=token(ids.adminB,ids.sessionB);
 for(const k of ['suppliers','product_groups','material_types','pallet_types'])expect((await call(path(ids.a,k),t,'POST',{code:'TEST',name:'Fixture '+k})).status).toBe(201);
 const foreign=await (await call(path(ids.b,'machine_types'),other,'POST',{code:'TYPE',name:'Foreign'})).json();
 const inactive=await (await call(path(ids.a,'machine_types'),t,'POST',{code:'OFF',name:'Inactive',active:false})).json();
 for(const id of [foreign.id,inactive.id])expect((await call(path(ids.a,'machines'),t,'POST',{code:'M',name:'Machine',machine_type_id:id})).status).toBe(400);
 const own=await (await call(path(ids.a,'machine_types'),t,'POST',{code:'ON',name:'Active'})).json();
 expect((await call(path(ids.a,'machines'),t,'POST',{code:'M',name:'Machine',machine_type_id:own.id})).status).toBe(201);
});
it('allows assignment of new permissions and still denies a read-only mutation',async()=>{
 const admin=token(ids.adminA,ids.session),read=token(ids.reader,ids.sessionRead);
 expect((await call(path(),read)).status).toBe(403);
 expect((await call(`/companies/${ids.a}/roles/${ids.readRole}`,admin,'PATCH',{name:'Read only',permissions:['access.read','masterdata.read']})).status).toBe(200);
 expect((await call(path(),read)).status).toBe(200);
 expect((await call(path(),read,'POST',{code:'NO',name:'No'})).status).toBe(403);
 expect((await call(`/companies/${ids.a}/roles`,admin,'POST',{name:'Invalid rights',permissions:['masterdata.manage']})).status).toBe(400);
});
