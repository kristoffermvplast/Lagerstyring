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

const path=(company=ids.a)=>`/companies/${company}/recipes`;
let product:string,component:string,recipe:any,revision:any;
it('publishes a recipe, checks stale writers and calculates through authenticated NestJS',async()=>{
 const t=token(ids.adminA,ids.session);
 const unit=await(await call(`/companies/${ids.a}/masterdata/units`,t,'POST',{code:'EACH',name:'Each',symbol:'ea',dimension:'count'})).json();
 for(const [code,kind]of[['PRODUCT','product'],['COMPONENT','material']]){const r=await call(`/companies/${ids.a}/items/${kind}`,t,'POST',{code,name:code,unit_id:unit.id});expect(r.status).toBe(201);const item=await r.json();if(kind==='product')product=item.id;else component=item.id;}
 const created=await call(path(),t,'POST',{product_id:product,kind:'bom',name:'Main recipe'});expect(created.status).toBe(201);recipe=await created.json();
 const payload={version:1,data:{base_quantity:'12',lines:[{component_id:component,kind:'component',quantity:'1'}]}};
 const published=await call(path()+'/'+recipe.id+'/revisions',t,'POST',payload);expect(published.status).toBe(201);revision=await published.json();expect(revision.snapshot.name).toBe('PRODUCT');
 expect((await call(path()+'/'+recipe.id+'/revisions',t,'POST',payload)).status).toBe(409);
 const result=await call(path()+'/calculate',t,'POST',{quantity:'1',bom_revision_id:revision.id});expect(result.status).toBe(201);expect((await result.json()).materials[0].quantity).toBe('0.08333334');
 const detail=await(await call(path()+'/'+recipe.id,t)).json();expect(detail.revisions).toHaveLength(1);expect(detail.version).toBe(2);
 expect((await call(path()+'/'+recipe.id,t,'PATCH',{version:2,data:{name:'Main recipe',is_default:true}})).status).toBe(200);
 expect((await(await call(path()+'?product_id='+product,t)).json())[0].is_default).toBe(true);
});
it('denies anonymous, foreign-company, foreign-revision and read-only writes',async()=>{
 const own=token(ids.adminA,ids.session),other=token(ids.adminB,ids.sessionB),read=token(ids.reader,ids.sessionRead);
 expect((await call(path()+'?product_id='+product)).status).toBe(401);
 expect((await call(path()+'?product_id='+product,other)).status).toBe(403);
 for(const suffix of ['','/history','/revisions/'+revision.id])expect((await call(path(ids.b)+'/'+recipe.id+suffix,other)).status).toBe(404);
 expect((await call(path(ids.b)+'/calculate',other,'POST',{quantity:'1',bom_revision_id:revision.id})).status).toBe(404);
 expect((await call(path()+'/'+recipe.id+'/revisions',other,'POST',{version:3,data:{lines:[{component_id:component,kind:'component',quantity:'1'}]}})).status).toBe(403);
 await call(`/companies/${ids.a}/roles/${ids.readRole}`,own,'PATCH',{name:'Read only',permissions:['access.read','masterdata.read']});
 expect((await call(path()+'/'+recipe.id,read)).status).toBe(200);
 expect((await call(path()+'/calculate',read,'POST',{quantity:'12',bom_revision_id:revision.id})).status).toBe(201);
 expect((await call(path(),read,'POST',{product_id:product,kind:'bom',name:'Denied'})).status).toBe(403);
 expect((await call(path()+'/'+recipe.id,read,'PATCH',{version:3,data:{name:'Denied'}})).status).toBe(403);
});
it('rejects invalid precision, forged fields, mismatched recipe IDs and invalid kinds',async()=>{
 const t=token(ids.adminA,ids.session);
 for(const quantity of ['-1','0','NaN','Infinity','1e3','0.000000001',1,{},'1000000000000'])expect((await call(path()+'/calculate',t,'POST',{quantity,bom_revision_id:revision.id})).status).toBe(400);
 expect((await call(path()+'/calculate',t,'POST',{quantity:'0.5',bom_revision_id:revision.id})).status).toBe(400);
 expect((await call(path()+'/calculate',t,'POST',{quantity:'1',packing_revision_id:revision.id})).status).toBe(400);
 expect((await call(path(),t,'POST',{product_id:product,kind:'bom',name:'Fake',company_id:ids.b})).status).toBe(400);
 const second=await(await call(path(),t,'POST',{product_id:product,kind:'bom',name:'Second'})).json();
 expect((await call(path()+'/'+second.id+'/revisions/'+revision.id,t)).status).toBe(404);
 expect((await call(path()+'/'+recipe.id+'/revisions',t,'POST',{version:3,data:{lines:[{component_id:component,kind:'component',quantity:'1',snapshot:{name:'Forged'}}]}})).status).toBe(400);
});
