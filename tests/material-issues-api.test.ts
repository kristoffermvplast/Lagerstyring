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

let product:string,material:string,box:string,unit:string,machine:string,bom:string,packing:string,owner:string,location:string,target:string,order:any,entry:any;
const path=(company=ids.a,id=order.id)=>`/companies/${company}/production-orders/${id}/material-issues`;
const body=()=>({idempotency_key:crypto.randomUUID(),item_id:material,owner_id:owner,from_location_id:location,to_location_id:target,quantity:'8.00000001',comment:'Local material issue'});
beforeAll(async()=>{await asUser(db,ids.adminA,ids.a,async()=>{

 unit=(await db.query<any>("insert into app.units(company_id,code,name,symbol,dimension) values($1,'PCS','Piece','stk.','count') returning id",[ids.a])).rows[0].id;
 const kg=(await db.query<any>("insert into app.units(company_id,code,name,symbol,dimension) values($1,'KG','Kilogram','kg','mass') returning id",[ids.a])).rows[0].id;
 machine=(await db.query<any>("insert into app.machines(company_id,code,name) values($1,'M','Test machine') returning id",[ids.a])).rows[0].id;
 product=(await db.query<any>("insert into app.items(company_id,kind,code,name,unit_id,standard_machine_id) values($1,'product','P','Original product',$2,$3) returning id",[ids.a,unit,machine])).rows[0].id;
 material=(await db.query<any>("insert into app.items(company_id,kind,code,name,unit_id) values($1,'material','X','Material',$2) returning id",[ids.a,kg])).rows[0].id;
 box=(await db.query<any>("insert into app.items(company_id,kind,code,name,unit_id) values($1,'packaging','BOX','Box',$2) returning id",[ids.a,unit])).rows[0].id;
 for(const kind of ['bom','packing']) {
  const r=(await db.query<any>('insert into app.recipes(company_id,product_id,kind,name) values($1,$2,$3,$3) returning id',[ids.a,product,kind])).rows[0].id;
  const v=(await db.query<any>('insert into app.recipe_revisions(company_id,recipe_id,revision) values($1,$2,1) returning id',[ids.a,r])).rows[0].id;
  await db.query('insert into app.recipe_lines(company_id,revision_id,component_id,kind,quantity) values($1,$2,$3,$4,$5)',[ids.a,v,kind==='bom'?material:box,kind==='bom'?'component':'container',kind==='bom'?'0.00825':'12']);
  await db.query('update app.recipe_revisions set sealed=true where id=$1',[v]);
  await db.query('update app.recipes set current_revision_id=$2,is_default=true,version=version+1 where id=$1',[r,v]);
  if(kind==='bom')bom=v;else packing=v;
 }

 owner=(await db.query<any>("insert into app.stock_owners(company_id,code,name,kind) values($1,'OWN','External owner','other') returning id",[ids.a])).rows[0].id;
 location=(await db.query<any>("insert into app.locations(company_id,code,name) values($1,'L','Warehouse') returning id",[ids.a])).rows[0].id;
 target=(await db.query<any>("insert into app.locations(company_id,code,name) values($1,'T','Production') returning id",[ids.a])).rows[0].id;
 await db.query('update app.machines set location_id=$2,version=version+1 where id=$1',[machine,target]);
 for(const i of [material,box])await db.query("insert into app.inventory_entries(company_id,idempotency_key,kind,reason,request) values($1,$2,'correction','Opening test stock',$3)",[ids.a,crypto.randomUUID(),JSON.stringify([{item_id:i,owner_id:owner,location_id:location,quantity:'10'}])]);
 });
 for(const code of ['production.read','inventory.read','inventory.transfer'])await db.query('insert into app.role_permissions values($1,$2,$3)',[ids.a,ids.readRole,code]);
 const r=await call(`/companies/${ids.a}/production-orders`,token(ids.adminA,ids.session),'POST',{idempotency_key:crypto.randomUUID(),product_id:product,code:'ISSUE-TEST',quantity:'504',machine_id:machine,bom_revision_id:bom,packing_revision_id:packing});expect(r.status).toBe(201);order=await r.json();
});
it('requires authentication, tenant and specific issue permission; draft cannot receive material',async()=>{
 expect((await call(path())).status).toBe(401);
 expect((await call(path(ids.b),token(ids.adminA,ids.session))).status).toBe(403);
 expect((await call(path(),token(ids.reader,ids.sessionRead),'POST',body())).status).toBe(403);
 expect((await call(path(),token(ids.adminA,ids.session),'POST',body())).status).toBe(409);
 const r=await call(`/companies/${ids.a}/production-orders/${order.id}/status`,token(ids.adminA,ids.session),'POST',{version:order.version,status:'planned'});expect(r.status).toBe(201);order=await r.json();
});
it('moves decimal stock once, preserves external ownership, records order and machine snapshot',async()=>{
 const t=token(ids.adminA,ids.session),b=body();const response=await call(path(),t,'POST',b);expect(response.status).toBe(201);entry=await response.json();
 expect(entry.production_order_id).toBe(order.id);expect(entry.production_snapshot.order_code).toBe('ISSUE-TEST');expect(entry.production_snapshot.machine.id).toBe(machine);
 expect(entry.lines.map((l:any)=>l.quantity)).toEqual(['-8.00000001','8.00000001']);expect(entry.lines.every((l:any)=>l.owner_id===owner)).toBe(true);
 expect((await(await call(path(),t,'POST',b)).json()).id).toBe(entry.id);expect((await call(path(),t,'POST',{...b,quantity:'1'})).status).toBe(409);
 expect((await db.query<any>('select sum(quantity)::text n from app.stock_balances where item_id=$1',[material])).rows[0].n).toBe('10.00000000');
 expect((await db.query<any>('select status from app.production_orders where id=$1',[order.id])).rows[0].status).toBe('planned');
 const opts=await(await call(path()+'/options',t)).json();expect(opts.machine_location_id).toBe(target);expect(opts.components.map((x:any)=>x.id)).toContain(material);
});
it('prevents draft rollback while material is assigned and keeps history immutable',async()=>{
 const t=token(ids.adminA,ids.session);
 expect((await call(`/companies/${ids.a}/production-orders/${order.id}/status`,t,'POST',{version:order.version,status:'draft'})).status).toBe(409);
 await asUser(db,ids.adminA,ids.a,()=>db.query("update app.machines set name='Renamed machine',version=version+1 where id=$1",[machine]));
 expect((await(await call(path()+'/'+entry.id,t)).json()).production_snapshot.machine.name).toBe('Test machine');
 await expect(asUser(db,ids.adminA,ids.a,()=>db.query('update app.inventory_entries set production_order_id=null where id=$1',[entry.id]))).rejects.toThrow();
});
it('rejects overdrafts, unrelated components, wrong machine location and bad quantities atomically',async()=>{
 const t=token(ids.adminA,ids.session),before=(await db.query<any>('select count(*)::int n from app.inventory_entries')).rows[0].n;
 for(const delta of [{quantity:'3'},{item_id:product},{to_location_id:location},{to_location_id:crypto.randomUUID()},{owner_id:crypto.randomUUID()},{quantity:'0'},{quantity:'0.000000001'},{quantity:1}])expect([400,409]).toContain((await call(path(),t,'POST',{...body(),...delta})).status);
 expect((await db.query<any>('select count(*)::int n from app.inventory_entries')).rows[0].n).toBe(before);
});
it('allows additional partial issue and packing stock without consuming either',async()=>{
 const t=token(ids.adminA,ids.session);
 expect((await call(path(),t,'POST',{...body(),quantity:'1'})).status).toBe(201);
 expect((await call(path(),t,'POST',{...body(),item_id:box,quantity:'2'})).status).toBe(201);
 expect((await db.query<any>('select sum(quantity)::text n from app.stock_balances where item_id=$1',[box])).rows[0].n).toBe('10.00000000');
});
it('reversal keeps order linkage, restores source stock and is shown in order history',async()=>{
 const t=token(ids.adminA,ids.session),r=await call(`/companies/${ids.a}/inventory/entries/${entry.id}/reverse`,t,'POST',{idempotency_key:crypto.randomUUID(),reason:'Correct issue mistake'});expect(r.status).toBe(201);
 const reversal=await r.json();expect(reversal.production_order_id).toBe(order.id);expect(reversal.production_snapshot).toEqual(entry.production_snapshot);
 const list=await(await call(path(),t)).json();expect(list.items.every((e:any)=>e.company_id===ids.a&&e.production_order_id===order.id)).toBe(true);expect(list.items.some((e:any)=>e.id===reversal.id)).toBe(true);
 expect((await call(path()+'/'+crypto.randomUUID(),t)).status).toBe(404);expect((await call(path(ids.b)+'/'+entry.id,t)).status).toBe(403);expect((await call(path(ids.a,crypto.randomUUID()),t)).status).toBe(404);
});
it('limited warehouse role can issue only after explicit permission grant and cannot invoke private guards',async()=>{
 await db.query("insert into app.role_permissions values($1,$2,'production.issue')",[ids.a,ids.readRole]);
 const r=await call(path(),token(ids.reader,ids.sessionRead),'POST',{...body(),quantity:'0.00825'});expect(r.status).toBe(201);
 const rights=(await db.query<any>("select has_function_privilege('app_backend','app_private.guard_production_issue()','EXECUTE') as invoke,has_column_privilege('app_backend','app.inventory_entries','production_snapshot','INSERT') as forge,has_table_privilege('app_backend','app.stock_balances','UPDATE') as balances")).rows[0];expect(rights).toEqual({invoke:false,forge:false,balances:false});
});
it('a problem blocks new material, and complete corrective reversals permit returning to draft',async()=>{
 const t=token(ids.adminA,ids.session);
 let r=await call(`/companies/${ids.a}/production-orders/${order.id}/problem`,t,'POST',{version:order.version,problem:'Hold material'});expect(r.status).toBe(201);order=await r.json();
 expect((await call(path(),t,'POST',{...body(),quantity:'1'})).status).toBe(409);
 const outstanding=(await db.query<any>("select id from app.inventory_entries e where production_order_id=$1 and kind='transfer' and not exists(select 1 from app.inventory_entries r where r.reverses_id=e.id)",[order.id])).rows;
 for(const e of outstanding)expect((await call(`/companies/${ids.a}/inventory/entries/${e.id}/reverse`,t,'POST',{idempotency_key:crypto.randomUUID(),reason:'Cancel incorrect issue'})).status).toBe(201);
 r=await call(`/companies/${ids.a}/production-orders/${order.id}/status`,t,'POST',{version:order.version,status:'draft'});expect(r.status).toBe(201);
 expect((await db.query<any>('select quantity from app.stock_balances where item_id=$1 and location_id=$2',[material,location])).rows[0].quantity).toBe('10.00000000');
});
