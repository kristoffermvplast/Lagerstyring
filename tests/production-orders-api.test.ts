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

const path=(company=ids.a)=>`/companies/${company}/production-orders`;
let product:string,material:string,box:string,unit:string,machine:string,bom:string,packing:string,order:any;
const input=()=>({idempotency_key:crypto.randomUUID(),product_id:product,code:'PO-'+crypto.randomUUID(),quantity:'504',machine_id:machine,bom_revision_id:bom,packing_revision_id:packing});
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
 });await db.query("insert into app.role_permissions values($1,$2,'production.read')",[ids.a,ids.readRole]);});
it('defaults, idempotent draft and exact snapshot-based demand without stock changes',async()=>{
 const t=token(ids.adminA,ids.session),defaults=await(await call(path()+'/defaults/'+product,t)).json();expect(defaults.machine_id).toBe(machine);expect(defaults.bom_revision_id).toBe(bom);expect(defaults.packing_revision_id).toBe(packing);
 const x=input(),r=await call(path(),t,'POST',x);expect(r.status).toBe(201);order=await r.json();expect(order.status).toBe('draft');expect(order.requirements.materials[0].quantity).toBe('4.158');expect(order.requirements.packaging[0].quantity).toBe('42');expect(order.snapshot.product.name).toBe('Original product');
 expect((await(await call(path(),t,'POST',x)).json()).id).toBe(order.id);expect((await call(path(),t,'POST',{...x,quantity:'505'})).status).toBe(409);
 expect((await db.query<any>('select count(*)::int n from app.inventory_entries')).rows[0].n).toBe(0);
});
it('requires complete data for planning, accepts incomplete drafts and rejects invalid quantity/dates',async()=>{
 const t=token(ids.adminA,ids.session);const r=await call(path(),t,'POST',{...input(),bom_revision_id:null,packing_revision_id:null,machine_id:null});expect(r.status).toBe(201);const draft=await r.json();expect(draft.warnings).toHaveLength(3);expect((await call(path()+'/'+draft.id+'/status',t,'POST',{version:1,status:'planned'})).status).toBe(409);
 for(const change of [{quantity:'0'},{quantity:'0.5'},{quantity:'no'},{quantity:'1.000000001'},{quantity:1},{status:'completed'},{company_id:ids.b},{planned_start:'2026-09-15T12:00:00Z',deadline:'2026-09-14T12:00:00Z'}])expect([400,409]).toContain((await call(path(),t,'POST',{...input(),...change})).status);
});
it('freezes planned snapshots and audits state changes with version conflicts',async()=>{
 const t=token(ids.adminA,ids.session);let r=await call(path()+'/'+order.id+'/status',t,'POST',{version:1,status:'planned'});expect(r.status).toBe(201);order=await r.json();
 await asUser(db,ids.adminA,ids.a,()=>db.query("update app.items set name='Changed product',version=version+1 where id=$1",[product]));
 const shown=await(await call(path()+'/'+order.id,t)).json();expect(shown.snapshot.product.name).toBe('Original product');expect(shown.requirements.materials[0].quantity).toBe('4.158');
 expect((await call(path()+'/'+order.id+'/status',t,'POST',{version:1,status:'ready'})).status).toBe(409);
 r=await call(path()+'/'+order.id+'/status',t,'POST',{version:order.version,status:'ready'});expect(r.status).toBe(201);order=await r.json();expect(order.status).toBe('ready');
 const history=await(await call(path()+'/'+order.id+'/history',t)).json();expect(history).toHaveLength(3);expect(history[0].before_value.status).toBe('planned');expect(history[0].after_value.status).toBe('ready');
});
it('problem remains separate, explicit return to draft permits changes and preserves history',async()=>{
 const t=token(ids.adminA,ids.session);let r=await call(path()+'/'+order.id+'/problem',t,'POST',{version:order.version,problem:'Machine unavailable'});expect(r.status).toBe(201);order=await r.json();expect(order.status).toBe('ready');expect(order.problem).toBe('Machine unavailable');
 order=await(await call(path()+'/'+order.id+'/status',t,'POST',{version:order.version,status:'planned'})).json();expect((await call(path()+'/'+order.id+'/status',t,'POST',{version:order.version,status:'ready'})).status).toBe(409);
 order=await(await call(path()+'/'+order.id+'/status',t,'POST',{version:order.version,status:'draft'})).json();
 const data={code:order.code,quantity:'505',machine_id:machine,bom_revision_id:bom,packing_revision_id:packing};r=await call(path()+'/'+order.id,t,'PATCH',{version:order.version,data});expect(r.status).toBe(200);order=await r.json();expect(order.snapshot.product.name).toBe('Changed product');expect(order.requirements.packaging[0].quantity).toBe('43');expect(order.requirements.containers[0].remainder).toBe('1');
 expect((await call(path()+'/'+order.id+'/status',t,'POST',{version:order.version,status:'in_production'})).status).toBe(400);
 const history=await(await call(path()+'/'+order.id+'/history',t)).json();expect(history.some((h:any)=>h.after_value.snapshot.product.name==='Original product')).toBe(true);
});
it('enforces permissions and company boundaries on all routes and database reads',async()=>{
 const t=token(ids.adminA,ids.session),other=token(ids.adminB,ids.sessionB),reader=token(ids.reader,ids.sessionRead);
 expect((await call(path())).status).toBe(401);expect((await call(path(),other)).status).toBe(403);expect((await call(path(),reader)).status).toBe(200);expect((await call(path()+'/'+order.id,reader)).status).toBe(200);expect((await call(path()+'/'+order.id+'/history',reader)).status).toBe(200);
 expect((await call(path(),reader,'POST',input())).status).toBe(403);expect((await call(path()+'/defaults/'+product,reader)).status).toBe(403);expect((await call(path(ids.b)+'/'+order.id,other)).status).toBe(404);expect((await call(path(ids.b)+'/'+order.id+'/history',other)).status).toBe(404);expect((await call(path(ids.b),other,'POST',input())).status).toBe(409);
 expect((await(await call(path(ids.b),other)).json()).items).toHaveLength(0);
 const empty=await asUser(db,ids.adminB,ids.b,()=>db.query('select * from app.production_orders'),ids.sessionB);expect(empty.rows).toHaveLength(0);
 const list=await(await call(path()+'?q='+order.code+'&status=draft&machine_id='+machine+'&limit=1',t)).json();expect(list.items).toHaveLength(1);expect(list.items[0].company_id).toBe(ids.a);
});
it('rejects foreign or wrong recipe references, and protects snapshots, audit and deletion',async()=>{
 const t=token(ids.adminA,ids.session);
 for(const change of [{bom_revision_id:packing},{packing_revision_id:bom},{machine_id:crypto.randomUUID()},{customer_id:crypto.randomUUID()},{product_id:material}])expect((await call(path(),t,'POST',{...input(),...change})).status).toBe(409);
 for(const sql of ['update app.production_orders set snapshot=\'{}\'','delete from app.production_orders','delete from app.production_order_audit','update app.production_order_audit set action=\'INSERT\''])await expect(asUser(db,ids.adminA,ids.a,()=>db.exec(sql))).rejects.toMatchObject({code:'42501'});
 await expect(asUser(db,ids.adminA,ids.a,()=>db.query("update app.production_orders set status='completed',version=version+1 where id=$1",[order.id]))).rejects.toMatchObject({code:'23514'});
 expect((await db.query<any>("select has_schema_privilege('anon','app','usage') allowed")).rows[0].allowed).toBe(false);
});

it('order packing overrides remain local and validate positive whole capacities',async()=>{
 const t=token(ids.adminA,ids.session);
 const r=await call(path(),t,'POST',{...input(),packing_overrides:[{component_id:box,quantity:'24'}]});expect(r.status).toBe(201);const data=await r.json();expect(data.requirements.packaging[0].quantity).toBe('21');expect(data.snapshot.packing.lines[0].quantity).toBe('24');
 expect((await db.query<any>('select quantity from app.recipe_lines where revision_id=$1',[packing])).rows[0].quantity).toBe('12.00000000');
 for(const overrides of [[{component_id:box,quantity:'0'}],[{component_id:box,quantity:'1.5'}],[{component_id:material,quantity:'24'}],[{component_id:box,quantity:'24'},{component_id:box,quantity:'12'}]])expect([400,409]).toContain((await call(path(),t,'POST',{...input(),packing_overrides:overrides})).status);
});
