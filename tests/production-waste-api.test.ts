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
const path=(company=ids.a,id=order.id)=>`/companies/${company}/production-orders/${id}/waste`;
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

let issue:any,returned:any,closed:any;
const bearer=()=>token(ids.adminA,ids.session);
const returns=()=>({idempotency_key:crypto.randomUUID(),issue_id:issue.id,to_location_id:location,quantity:'2',comment:'Unused material returned'});
async function status(value:string){const r=await call(`/companies/${ids.a}/production-orders/${order.id}/status`,bearer(),'POST',{version:order.version,status:value});expect(r.status).toBe(201);order=await r.json();}
async function review(){return(await call(path().replace('/waste','/close')+'/review',bearer())).json();}
beforeAll(async()=>{
 await status('planned');await status('ready');await status('in_production');
 const r=await call(`/companies/${ids.a}/production-orders/${order.id}/material-issues`,bearer(),'POST',body());expect(r.status).toBe(201);issue=await r.json();
 expect((await call(`/companies/${ids.a}/production-orders/${order.id}/registrations`,bearer(),'POST',{idempotency_key:crypto.randomUUID(),quantity:'500'})).status).toBe(201);
});
const waste=()=>({idempotency_key:crypto.randomUUID(),issue_id:issue.id,quantity:'1.25',comment:'Measured separately, no inventory debit'});
async function analysis(){const r=await call(path()+'/analysis',bearer());expect(r.status).toBe(200);return r.json();}
let observation:any;
it('requires authentication, read rights, waste rights and same-company order access',async()=>{
 for(const suffix of ['','/analysis','/'+crypto.randomUUID()]){expect((await call(path()+suffix)).status).toBe(401);expect((await call(path(ids.b)+suffix,bearer())).status).toBe(403);expect((await call(path(ids.a,crypto.randomUUID())+suffix,bearer())).status).toBe(404);}
 expect((await call(path(),token(ids.reader,ids.sessionRead),'POST',waste())).status).toBe(403);
 expect((await call(path(ids.b),bearer(),'POST',waste())).status).toBe(403);
});
it('uses frozen BOM, computes exact difference, preserves units and does not label difference as waste',async()=>{
 const a=await analysis(),m=a.materials.find((m:any)=>m.item_id===material);expect(a.final).toBe(false);expect(m.theoretical_quantity).toBe('4.12500000');expect(m.difference_quantity).toBe('3.87500001');expect(m.measured_waste_quantity).toBe('0.00000000');expect(m.warnings).toContain('PROVISIONAL_UNRETURNED_STOCK');
 expect(a.materials.find((m:any)=>m.item_id===box).theoretical_quantity).toBe('42.00000000');
 await asUser(db,ids.adminA,ids.a,()=>db.query("update app.items set name='Changed masterdata',version=version+1 where id=$1",[material]));
 expect((await analysis()).materials.find((m:any)=>m.item_id===material).name).toBe('Material');
});
it('records physical waste once with historical item, unit and owner without a stock mutation',async()=>{
 const before=await db.query('select * from app.stock_balances order by item_id,owner_id,location_id');
 const b=waste(),r=await call(path(),bearer(),'POST',b);expect(r.status).toBe(201);observation=await r.json();expect(observation.owner_id).toBe(owner);expect(observation.item_id).toBe(material);expect(observation.snapshot.stock.item.name).toBe('Material');
 expect((await(await call(path(),bearer(),'POST',b)).json()).id).toBe(observation.id);expect((await call(path(),bearer(),'POST',{...b,quantity:'2'})).status).toBe(409);
 expect((await db.query('select * from app.stock_balances order by item_id,owner_id,location_id')).rows).toEqual(before.rows);
 const m=(await analysis()).materials.find((m:any)=>m.item_id===material);expect(m.measured_waste_quantity).toBe('1.25000000');expect(m.unexplained_quantity).toBe('2.62500001');
 for(const change of [{quantity:'0'},{quantity:'-1'},{quantity:'0.000000001'},{item_id:material},{snapshot:{}},{created_by:ids.adminB}])expect((await call(path(),bearer(),'POST',{...waste(),...change})).status).toBe(400);
 expect((await call(path(),bearer(),'POST',{...waste(),issue_id:crypto.randomUUID()})).status).toBe(409);
});
it('permits measured anomalies, reports them and corrects by immutable reversal with separate rights',async()=>{
 const r=await call(path(),bearer(),'POST',{...waste(),quantity:'20'});expect(r.status).toBe(201);const big=await r.json();
 expect((await analysis()).materials.find((m:any)=>m.item_id===material).warnings).toContain('MEASURED_WASTE_EXCEEDS_NET');
 const b={idempotency_key:crypto.randomUUID(),comment:'Measurement recorded twice'};
 expect((await call(path()+'/'+big.id+'/reverse',token(ids.reader,ids.sessionRead),'POST',b)).status).toBe(403);
 await db.query("insert into app.role_permissions values($1,$2,'production.waste.correct')",[ids.a,ids.readRole]);
 const corrector=token(ids.reader,ids.sessionRead),rev=await call(path()+'/'+big.id+'/reverse',corrector,'POST',b);expect(rev.status).toBe(201);const reversal=await rev.json();expect(reversal.quantity).toBe('20.00000000');expect(reversal.reverses_id).toBe(big.id);
 expect((await(await call(path()+'/'+big.id+'/reverse',corrector,'POST',b)).json()).id).toBe(reversal.id);
 expect((await call(path()+'/'+big.id+'/reverse',corrector,'POST',{...b,idempotency_key:crypto.randomUUID()})).status).toBe(409);
 expect((await analysis()).materials.find((m:any)=>m.item_id===material).measured_waste_quantity).toBe('1.25000000');
 await expect(db.query('delete from app.production_waste where id=$1',[big.id])).rejects.toThrow();
 await expect(db.query("update app.production_waste set comment='Overwrite' where id=$1",[big.id])).rejects.toThrow();
});
it('count-unit waste requires whole quantities',async()=>{
 const r=await call(`/companies/${ids.a}/production-orders/${order.id}/material-issues`,bearer(),'POST',{...body(),item_id:box,quantity:'2'});expect(r.status).toBe(201);const boxed=await r.json();
 expect((await call(path(),bearer(),'POST',{...waste(),issue_id:boxed.id,quantity:'0.5'})).status).toBe(409);
});
it('completion consumes once; later waste observations preserve closure and stock',async()=>{
 await status('reconciliation');const x=await review();
 const response=await call(path().replace('/waste','/close'),bearer(),'POST',{idempotency_key:crypto.randomUUID(),review_token:x.review_token,rejected_quantity:'4',comment:'Reconciled including physical waste',confirm_materials:true});expect(response.status).toBe(201);closed=await response.json();
 const stock=await db.query('select * from app.stock_balances order by item_id,owner_id,location_id');
 expect((await call(path(),bearer(),'POST',{...waste(),quantity:'0.25'})).status).toBe(201);
 expect((await analysis()).final).toBe(true);expect((await analysis()).materials.find((m:any)=>m.item_id===material).measured_waste_quantity).toBe('1.50000000');
 expect((await db.query('select * from app.stock_balances order by item_id,owner_id,location_id')).rows).toEqual(stock.rows);
 expect((await db.query<any>('select snapshot from app.production_closures where id=$1',[closed.id])).rows[0].snapshot).toEqual(closed.snapshot);
 expect((await db.query<any>("select count(*)::int n from app.inventory_entries where kind='production_consumption'")).rows[0].n).toBe(1);
});
it('history and analysis scope remain isolated including direct runtime access and protected columns',async()=>{
 const h=await(await call(path(),bearer())).json();expect(h.total).toBe(4);expect(h.items.every((x:any)=>x.company_id===ids.a&&x.order_id===order.id)).toBe(true);
 expect((await call(path()+'/'+observation.id,bearer())).status).toBe(200);
 expect((await asUser(db,ids.adminB,ids.b,()=>db.query('select * from app.production_waste'),ids.sessionB)).rows).toHaveLength(0);
 const grants=(await db.query<any>("select has_table_privilege('authenticated','app.production_waste','SELECT') browser,has_column_privilege('app_backend','app.production_waste','snapshot','INSERT') snapshot,has_column_privilege('app_backend','app.production_waste','item_id','INSERT') item,has_column_privilege('app_backend','app.production_waste','created_by','INSERT') actor,has_function_privilege('app_backend','app_private.prepare_production_waste()','EXECUTE') invoke")).rows[0];expect(grants).toEqual({browser:false,snapshot:false,item:false,actor:false,invoke:false});
});
it('period analysis filters completed history and remains company scoped',async()=>{
 const root=`/companies/${ids.a}/production-analysis`;
 expect((await call(root)).status).toBe(401);expect((await call(`/companies/${ids.b}/production-analysis`,bearer())).status).toBe(403);
 const r=await call(root+'?product=Original&material=Material&machine=Test',bearer());expect(r.status).toBe(200);const h=await r.json();expect(h.total).toBe(1);expect(h.items[0].company_id).toBe(ids.a);expect(h.items[0].order_id).toBe(order.id);expect(h.items[0].materials.find((m:any)=>m.item_id===material).measured_waste_quantity).toBe('1.50000000');
 expect((await(await call(root+'?material=Missing',bearer())).json()).total).toBe(0);
 expect((await(await call(root+'?to=2000-01-01T00:00:00Z',bearer())).json()).total).toBe(0);
 expect((await call(root+'?from=2030-01-01T00:00:00Z&to=2000-01-01T00:00:00Z',bearer())).status).toBe(400);
});
it('role administration retains measured-waste and correction permissions',async()=>{
 const permissions=['production.read','inventory.read','production.waste','production.waste.correct'];
 const r=await call(`/companies/${ids.a}/roles`,bearer(),'POST',{name:'Waste observers',permissions});expect(r.status).toBe(201);const role=await r.json();
 const roles=await(await call(`/companies/${ids.a}/roles`,bearer())).json();expect(roles.find((x:any)=>x.id===role.id).permissions.sort()).toEqual(permissions.sort());
});
