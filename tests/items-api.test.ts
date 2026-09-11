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

const path=(company=ids.a,kind='product')=>`/companies/${company}/items/${kind}`;
let item:any;
it('creates a minimal item, preserves audit and rejects stale edits',async()=>{
 const t=token(ids.adminA,ids.session);
 const r=await call(path(),t,'POST',{code:'ITEM-1',name:'First item'});expect(r.status).toBe(201);item=await r.json();expect(item.unit_id).toBeNull();
 expect((await call(path()+'/'+item.id,t)).status).toBe(200);
 expect((await call(path()+'/'+item.id,t,'PATCH',{version:1,data:{code:'ITEM-1',name:'Renamed',active:false}})).status).toBe(200);
 expect((await call(path()+'/'+item.id,t,'PATCH',{version:1,data:{code:'ITEM-1',name:'Stale'}})).status).toBe(409);
 const h=await (await call(path()+'/'+item.id+'/history',t)).json();expect(h).toHaveLength(2);expect(h[0].before_value.name).toBe('First item');
 expect((await (await call(path()+'?active=false',t)).json()).total).toBe(1);
});
it('isolates list, detail, write, kind and audit and blocks forged fields',async()=>{
 const own=token(ids.adminA,ids.session),other=token(ids.adminB,ids.sessionB);
 expect((await call(path(),other)).status).toBe(403);
 for(const suffix of ['','/history'])expect((await call(path(ids.b)+'/'+item.id+suffix,other)).status).toBe(404);
 expect((await call(path(ids.a,'material')+'/'+item.id,own)).status).toBe(404);
 expect((await call(path(ids.b)+'/'+item.id,other,'PATCH',{version:2,data:{code:'X',name:'Foreign'}})).status).toBe(404);
 for(const extra of [{company_id:ids.b},{kind:'material'},{physical_stock:'10'},{photo_key:'forged'}])expect((await call(path(),own,'POST',{code:'X',name:'X',...extra})).status).toBe(400);
 expect((await call(path()+'?sort=company_id',own)).status).toBe(400);
 expect((await call(path()+'?limit=101',own)).status).toBe(400);
});
it('preserves eight decimal places, validates ranges and reference assignment',async()=>{
 const t=token(ids.adminA,ids.session),other=token(ids.adminB,ids.sessionB);
 const master=(kind:string,company=ids.a)=>`/companies/${company}/masterdata/${kind}`;
 const unit=await (await call(master('units'),t,'POST',{code:'MASS',name:'Mass',symbol:'mass',dimension:'mass'})).json();
 const supplier=await (await call(master('suppliers'),t,'POST',{code:'SUP',name:'Supplier'})).json();
 const foreign=await (await call(master('units',ids.b),other,'POST',{code:'MASS',name:'Other mass',symbol:'m',dimension:'mass'})).json();
 const body={code:'MAT-1',name:'Material',unit_id:unit.id,supplier_id:supplier.id,minimum_stock:'0.00825001',maximum_stock:'999999999999.99999999'};
 const r=await call(path(ids.a,'material'),t,'POST',body);expect(r.status).toBe(201);const m=await r.json();expect(m.minimum_stock).toBe('0.00825001');expect(m.maximum_stock).toBe('999999999999.99999999');
 for(const bad of [{unit_id:foreign.id},{minimum_stock:0.1},{minimum_stock:'1e3'},{minimum_stock:'0.000000001'},{minimum_stock:'-1'},{minimum_stock:'NaN'},{minimum_stock:'Infinity'},{minimum_stock:'1000000000000'},{desired_stock:'0.00000001'}])expect((await call(path(ids.a,'material'),t,'POST',{...body,code:'BAD',...bad})).status).toBeGreaterThanOrEqual(400);
 expect((await call(path(ids.a,'material')+'/'+m.id,t,'PATCH',{version:1,data:{...body,unit_id:null,minimum_stock:null,maximum_stock:null}})).status).toBe(409);
 expect((await (await call(path(ids.a,'material')+'?supplier_id='+supplier.id,t)).json()).total).toBe(1);
 expect((await call(master('suppliers')+'/'+supplier.id,t,'PATCH',{version:1,data:{code:'SUP',name:'Supplier',active:false}})).status).toBe(200);
 expect((await call(path(ids.a,'material')+'/'+m.id,t,'PATCH',{version:1,data:{...body,name:'Same inactive reference'}})).status).toBe(200);
 expect((await call(path(ids.a,'material'),t,'POST',{...body,code:'NEW'})).status).toBe(409);
});
it('enforces one code namespace, distinct kinds, permissions and missing-unit validation',async()=>{
 const t=token(ids.adminA,ids.session),read=token(ids.reader,ids.sessionRead),other=token(ids.adminB,ids.sessionB);
 expect((await call(path(ids.a,'packaging'),t,'POST',{code:'item-1',name:'Duplicate'})).status).toBe(409);
 expect((await call(path(ids.b,'packaging'),other,'POST',{code:'ITEM-1',name:'Other company'})).status).toBe(201);
 expect((await call(path(ids.a,'packaging'),t,'POST',{code:'PACK',name:'Packaging'})).status).toBe(201);
 expect((await call(path(),t,'POST',{code:'UNIT',name:'Missing unit',minimum_stock:'1'})).status).toBe(400);
 expect((await call(path(ids.a,'material'),t,'POST',{code:'BAD',name:'Bad',cavities:2})).status).toBe(400);
 expect((await call(path(),t,'POST',{code:'BAD',name:'Bad',cycle_time_seconds:'0'})).status).toBe(400);
 expect((await call(path(),read)).status).toBe(403);
 await call(`/companies/${ids.a}/roles/${ids.readRole}`,t,'PATCH',{name:'Read only',permissions:['access.read','masterdata.read']});
 expect((await call(path(),read)).status).toBe(200);
 expect((await call(path(),read,'POST',{code:'DENIED',name:'Denied'})).status).toBe(403);
 expect((await call(path()+'/'+item.id,read,'PATCH',{version:2,data:{code:'DENIED',name:'Denied'}})).status).toBe(403);
});

it('checks photo rights before storage, versions uploads, preserves history and hides foreign photos',async()=>{
 const {ItemPhotoStorage}=require('../apps/api/dist/item-photos.js');
 const storage=app.get(ItemPhotoStorage),objects=new Map<string,Buffer>();let calls=0;
 const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a1XcAAAAASUVORK5CYII=';
 const t=token(ids.adminA,ids.session),other=token(ids.adminB,ids.sessionB),reader=token(ids.reader,ids.sessionRead);
 const endpoint=path()+'/'+item.id+'/photo';
 expect(await (await call(endpoint,t)).json()).toEqual({enabled:false,photo:null});
 Object.defineProperty(storage,'enabled',{get:()=>true});
 storage.upload=async(key:string,data:Buffer)=>{calls++;objects.set(key,data);};storage.read=async(key:string)=>{calls++;return objects.get(key);};
 const body={version:2,mime:'image/png',base64:png};
 expect((await call(endpoint,reader,'POST',body)).status).toBe(403);
 expect((await call(path(ids.b)+'/'+item.id+'/photo',other)).status).toBe(404);expect(calls).toBe(0);
 expect((await call(endpoint,t,'POST',body)).status).toBe(201);expect(objects.size).toBe(1);
 expect(await (await call(endpoint,t)).json()).toEqual({enabled:true,photo:{mime:'image/png',base64:png}});
 expect((await call(endpoint,t,'POST',body)).status).toBe(409);expect(objects.size).toBe(1);
 const detail=await (await call(path()+'/'+item.id,t)).json();expect(detail.version).toBe(3);expect(detail.photo_key.startsWith(ids.a+'/'+item.id+'/')).toBe(true);
 const h=await (await call(path()+'/'+item.id+'/history',t)).json();expect(h[0].after_value.photo_key).toBe(detail.photo_key);
 expect((await call(endpoint,t,'POST',{...body,version:3,mime:'image/svg+xml'})).status).toBe(400);
 storage.upload=async()=>{throw new (require('@nestjs/common').ServiceUnavailableException)();};
 expect((await call(endpoint,t,'POST',{...body,version:3})).status).toBe(503);
 expect((await (await call(path()+'/'+item.id,t)).json()).version).toBe(3);
});
it('same-company masterdata detail endpoint cannot disclose foreign references',async()=>{
 const t=token(ids.adminA,ids.session),other=token(ids.adminB,ids.sessionB);
 const p=`/companies/${ids.a}/masterdata/product_groups`;
 const record=await (await call(p,t,'POST',{code:'DETAIL',name:'Group detail'})).json();
 expect((await call(p+'/'+record.id,t)).status).toBe(200);
 expect((await call(`/companies/${ids.b}/masterdata/product_groups/${record.id}`,other)).status).toBe(404);
 expect((await call(p+'/'+record.id,other)).status).toBe(403);
});
