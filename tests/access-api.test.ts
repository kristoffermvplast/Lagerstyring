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
 else {const result=await db.query(sql,values);return {rows:result.rows,rowCount:result.affectedRows??result.rows.length};}
 return {rows:[],rowCount:0};
 },release:()=>{}})};
 app=await createApp(config,service);await app.listen(0,'127.0.0.1');origin=await app.getUrl();
});
afterAll(async()=>{await app?.close();await new Promise<void>(resolve=>provider?.close(()=>resolve()));await db?.close();});
describe('NestJS Auth and access endpoints with real RLS',()=>{
 it('rejects absent, forged and expired bearer credentials',async()=>{
  expect((await call('/me')).status).toBe(401);
  expect((await call('/me','a.b.c')).status).toBe(401);
  expect((await call('/me',token(ids.adminA,ids.session,{exp:1}))).status).toBe(401);
 });
 it('rejects incorrect issuer, role, subject and missing session',async()=>{
  for(const overrides of [{iss:'https://wrong.test/auth/v1'},{role:'service_role'},{session_id:null},{sub:ids.adminB}])expect((await call('/me',token(ids.adminA,ids.session,overrides))).status).toBe(401);
 });
 it('returns only own profile and legitimate memberships',async()=>{
  const r=await call('/me',token(ids.adminA,ids.session));expect(r.status).toBe(200);const me=await r.json();expect(me.user.id).toBe(ids.adminA);expect(me.memberships.map((m:any)=>m.company_id)).toEqual([ids.a]);
 });
 it('rejects cross-company reads and writes even for an administrator',async()=>{
  const t=token(ids.adminA,ids.session);
  expect((await call(`/companies/${ids.b}/members`,t)).status).toBe(403);
  expect((await call(`/companies/${ids.b}/roles`,t,'POST',{name:'Attack',permissions:[]})).status).toBe(403);
 });
 it('ignores metadata for permissions and rejects read-only mutation',async()=>{
  const t=token(ids.reader,ids.sessionRead,{user_metadata:{role:'ADMINISTRATOR',company_id:ids.b}});
  expect((await call(`/companies/${ids.a}/members`,t)).status).toBe(200);
  expect((await call(`/companies/${ids.a}/roles`,t,'POST',{name:'Attack',permissions:[]})).status).toBe(403);
 });
 it('saves profiles through backend and rejects extra fields',async()=>{
  const t=token(ids.adminA,ids.session);
  expect((await call('/me',t,'PATCH',{displayName:'Updated'})).status).toBe(200);
  expect((await call('/me',t,'PATCH',{displayName:'Updated',role:'ADMINISTRATOR'})).status).toBe(400);
 });
 it('creates a role, audits it and prevents stale membership changes',async()=>{
  const t=token(ids.adminA,ids.session);
  const r=await call(`/companies/${ids.a}/roles`,t,'POST',{name:'Reviewer',permissions:['access.read']});expect(r.status).toBe(201);
  expect((await call(`/companies/${ids.a}/access-audit`,t)).status).toBe(200);
  expect((await call(`/companies/${ids.a}/members/${ids.reader}`,t,'PATCH',{roleId:ids.readRole,active:false,version:999})).status).toBe(409);
  expect((await call(`/companies/${ids.a}/members/${ids.adminA}`,t,'PATCH',{roleId:ids.roleA,active:false,version:1})).status).toBe(409);
 });
 it('rejects a deleted Supabase session despite an otherwise accepted token',async()=>{
  const t=token(ids.newcomer,ids.sessionNew);
  await db.query('delete from auth.sessions where id=$1',[ids.sessionNew]);
  expect((await call('/me',t)).status).toBe(401);
 });
 it('logout revokes the session; replay cannot access any company',async()=>{
  const t=token(ids.adminB,ids.sessionB);
  expect((await call('/auth/logout',t,'POST')).status).toBe(201);
  expect((await call('/me',t)).status).toBe(401);
  expect((await call(`/companies/${ids.b}/members`,t)).status).toBe(401);
 });
});
