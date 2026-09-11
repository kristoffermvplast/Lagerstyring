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

const path=(company=ids.a)=>`/companies/${company}/locations`;
let root:any,child:any;
it('creates hierarchy, navigates paths, filters and excludes descendants through NestJS',async()=>{
 const t=token(ids.adminA,ids.session);
 root=await(await call(path(),t,'POST',{code:'ROOT',name:'Root',is_storage:false})).json();
 child=await(await call(path(),t,'POST',{code:'CHILD',name:'Child',parent_id:root.id})).json();
 expect(root.id).toBeTruthy();expect(child.id).toBeTruthy();
 const detail=await(await call(path()+'/'+child.id,t)).json();expect(detail.path.map((x:any)=>x.id)).toEqual([root.id,child.id]);
 const roots=await(await call(path()+'?parent_id=root',t)).json();expect(roots.total).toBe(1);expect(roots.items[0].child_count).toBe(1);
 expect((await(await call(path()+'?parent_id='+root.id,t)).json()).items[0].id).toBe(child.id);
 expect((await(await call(path()+'?exclude_subtree='+root.id,t)).json()).total).toBe(0);
 expect((await(await call(path()+'?storage=true&q=Child',t)).json()).total).toBe(1);
 expect((await(await call(path()+'?limit=1&page=2&sort=code&direction=asc',t)).json()).items[0].id).toBe(root.id);
});
it('enforces version, hierarchy and strict payload constraints',async()=>{
 const t=token(ids.adminA,ids.session);
 expect((await call(path()+'/'+root.id,t,'PATCH',{version:1,data:{code:'ROOT',name:'Cycle',parent_id:child.id}})).status).toBe(409);
 expect((await call(path()+'/'+root.id,t,'PATCH',{version:1,data:{code:'ROOT',name:'Inactive',active:false}})).status).toBe(409);
 expect((await call(path()+'/'+root.id,t,'PATCH',{version:1,data:{code:'ROOT',name:'Renamed',is_storage:false}})).status).toBe(200);
 expect((await call(path()+'/'+root.id,t,'PATCH',{version:1,data:{code:'ROOT',name:'Stale'}})).status).toBe(409);
 expect((await(await call(path()+'/'+root.id+'/history',t)).json())).toHaveLength(2);
 expect((await call(path(),t,'POST',{code:'X',name:'Forged',company_id:ids.b})).status).toBe(400);
 expect((await call(path()+'?sort=version',t)).status).toBe(400);
});
it('denies anonymous and foreign access, permits read-only navigation but no writes',async()=>{
 const own=token(ids.adminA,ids.session),other=token(ids.adminB,ids.sessionB),read=token(ids.reader,ids.sessionRead);
 expect((await call(path())).status).toBe(401);
 expect((await call(path(),other)).status).toBe(403);
 for(const suffix of ['', '/history'])expect((await call(path(ids.b)+'/'+root.id+suffix,other)).status).toBe(404);
 expect((await call(path(ids.b)+'?parent_id='+root.id,other)).status).toBe(404);
 expect((await call(path(ids.b),other,'POST',{code:'FOREIGN',name:'Foreign',parent_id:root.id})).status).toBe(409);
 await call(`/companies/${ids.a}/roles/${ids.readRole}`,own,'PATCH',{name:'Read only',permissions:['access.read','masterdata.read']});
 expect((await call(path()+'/'+root.id,read)).status).toBe(200);
 expect((await call(path(),read,'POST',{code:'DENIED',name:'Denied'})).status).toBe(403);
 expect((await call(path()+'/'+root.id,read,'PATCH',{version:2,data:{code:'ROOT',name:'Denied'}})).status).toBe(403);
});
