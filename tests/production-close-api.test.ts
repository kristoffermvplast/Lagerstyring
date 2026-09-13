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
const path=(company=ids.a,id=order.id)=>`/companies/${company}/production-orders/${id}/close`;
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
async function review(){return(await call(path()+'/review',bearer())).json();}
beforeAll(async()=>{
 await status('planned');await status('ready');await status('in_production');
 const r=await call(`/companies/${ids.a}/production-orders/${order.id}/material-issues`,bearer(),'POST',body());expect(r.status).toBe(201);issue=await r.json();
 expect((await call(`/companies/${ids.a}/production-orders/${order.id}/registrations`,bearer(),'POST',{idempotency_key:crypto.randomUUID(),quantity:'500'})).status).toBe(201);
});
it('close routes fail closed for anonymous, foreign company and missing permissions',async()=>{
 for(const route of ['/review','/returns','/result']){expect((await call(path()+route)).status).toBe(401);expect((await call(path(ids.b)+route,bearer())).status).toBe(403);expect((await call(path(ids.a,crypto.randomUUID())+route,bearer())).status).toBe(404);}
 expect((await call(path()+'/returns',token(ids.reader,ids.sessionRead),'POST',returns())).status).toBe(403);
 expect((await call(path()+'/result',bearer())).status).toBe(404);
});
it('returns only the original issued stock, once, with exact decimals and owner intact',async()=>{
 const before=await review();expect(before.materials[0].remaining_quantity).toBe('8.00000001');
 await db.query("insert into app.role_permissions values($1,$2,'production.return')",[ids.a,ids.readRole]);
 const b=returns(),r=await call(path()+'/returns',token(ids.reader,ids.sessionRead),'POST',b);expect(r.status).toBe(201);returned=await r.json();expect(returned.production_return_of).toBe(issue.id);expect(returned.production_snapshot).toEqual(issue.production_snapshot);
 expect((await(await call(path()+'/returns',bearer(),'POST',b)).json()).id).toBe(returned.id);
 expect((await call(path()+'/returns',bearer(),'POST',{...b,quantity:'1'})).status).toBe(409);
 const next=await review();expect(next.materials[0].remaining_quantity).toBe('6.00000001');expect(next.materials[0].returned_quantity).toBe('2.00000000');expect(next.materials[0].owner_id).toBe(owner);
 expect((await db.query<any>('select sum(quantity)::text n from app.stock_balances where item_id=$1',[material])).rows[0].n).toBe('10.00000000');
 for(const change of [{quantity:'7'},{quantity:'0'},{quantity:'0.000000001'},{issue_id:crypto.randomUUID()},{to_location_id:target},{to_location_id:crypto.randomUUID()}])expect([400,404,409]).toContain((await call(path()+'/returns',bearer(),'POST',{...returns(),...change})).status);
 expect((await call(`/companies/${ids.a}/inventory/entries/${issue.id}/reverse`,bearer(),'POST',{idempotency_key:crypto.randomUUID(),reason:'Cannot bypass returns'})).status).toBe(409);
 // Another order shares this production location and owner; its allocation must survive closure.
 let second=await(await call(`/companies/${ids.a}/production-orders`,bearer(),'POST',{idempotency_key:crypto.randomUUID(),product_id:product,code:'SECOND',quantity:'10',machine_id:machine,bom_revision_id:bom,packing_revision_id:packing})).json();
 second=await(await call(`/companies/${ids.a}/production-orders/${second.id}/status`,bearer(),'POST',{version:second.version,status:'planned'})).json();
 const otherIssue=await(await call(`/companies/${ids.a}/production-orders/${second.id}/material-issues`,bearer(),'POST',{...body(),quantity:'1'})).json();
 expect((await call(path()+'/returns',bearer(),'POST',{...returns(),issue_id:otherIssue.id,quantity:'1'})).status).toBe(404);
});
it('reconciliation pauses registration and issue, allows return, and rejects stale review',async()=>{
 await status('reconciliation');const old=await review();
 expect((await call(`/companies/${ids.a}/production-orders/${order.id}/registrations`,bearer(),'POST',{idempotency_key:crypto.randomUUID(),quantity:'1'})).status).toBe(409);
 expect((await call(`/companies/${ids.a}/production-orders/${order.id}/material-issues`,bearer(),'POST',{...body(),quantity:'1'})).status).toBe(409);
 expect((await call(path()+'/returns',bearer(),'POST',{...returns(),quantity:'0.00000001'})).status).toBe(201);
 expect((await call(path(),bearer(),'POST',{idempotency_key:crypto.randomUUID(),review_token:old.review_token,rejected_quantity:'4',comment:'Final checked',confirm_materials:true})).status).toBe(409);
 expect((await db.query<any>('select count(*)::int n from app.production_closures')).rows[0].n).toBe(0);
 await status('in_production');await status('reconciliation');
});
it('negative stock causes complete rollback of closure, consumption and status',async()=>{
 const adjust=async(q:string)=>asUser(db,ids.adminA,ids.a,()=>db.query("insert into app.inventory_entries(company_id,idempotency_key,kind,reason,request) values($1,$2,'correction','Local discrepancy',$3)",[ids.a,crypto.randomUUID(),JSON.stringify([{item_id:material,owner_id:owner,location_id:target,quantity:q}])]));
 await adjust('-2');const x=await review();
 const r=await call(path(),bearer(),'POST',{idempotency_key:crypto.randomUUID(),review_token:x.review_token,rejected_quantity:'4',comment:'Final checked',confirm_materials:true});expect(r.status).toBe(409);
 expect((await db.query<any>('select count(*)::int n from app.production_closures')).rows[0].n).toBe(0);
 expect((await db.query<any>("select count(*)::int n from app.inventory_entries where kind='production_consumption'")).rows[0].n).toBe(0);
 expect((await db.query<any>('select status from app.production_orders where id=$1',[order.id])).rows[0].status).toBe('reconciliation');await adjust('2');
});
it('final confirmation consumes only outstanding material and freezes closure without finished stock',async()=>{
 const x=await review(),b={idempotency_key:crypto.randomUUID(),review_token:x.review_token,rejected_quantity:'4',comment:'Final quantities reconciled',confirm_materials:true};
 expect((await call(path(),token(ids.reader,ids.sessionRead),'POST',b)).status).toBe(403);
 expect((await call(path(),bearer(),'POST',{...b,confirm_materials:false})).status).toBe(400);
 expect((await call(path(),bearer(),'POST',{...b,rejected_quantity:'0.5'})).status).toBe(409);
 const r=await call(path(),bearer(),'POST',b);expect(r.status).toBe(201);closed=await r.json();
 expect(closed.snapshot.good_quantity).toBe('500.00000000');expect(closed.snapshot.rejected_quantity).toBe('4.00000000');expect(closed.snapshot.materials[0].remaining_quantity).toBe('6.00000000');
 expect((await(await call(path(),bearer(),'POST',b)).json()).id).toBe(closed.id);expect((await call(path(),bearer(),'POST',{...b,comment:'Changed'})).status).toBe(409);
 expect((await db.query<any>('select quantity from app.stock_balances where item_id=$1 and location_id=$2',[material,target])).rows[0].quantity).toBe('1.00000000');
 expect((await db.query<any>('select quantity from app.stock_balances where item_id=$1 and location_id=$2',[material,location])).rows[0].quantity).toBe('3.00000000');
 expect((await db.query<any>('select count(*)::int n from app.stock_balances where item_id=$1',[product])).rows[0].n).toBe(0);
 expect((await db.query<any>("select count(*)::int n from app.inventory_entries where kind='production_consumption'")).rows[0].n).toBe(1);
 expect((await db.query<any>('select status from app.production_orders where id=$1',[order.id])).rows[0].status).toBe('completed');
 expect((await(await call(path()+'/result',bearer())).json()).id).toBe(closed.id);
});
it('closed order rejects return, issue reversal, edit and status bypass; private writers remain inaccessible',async()=>{
 expect((await call(path()+'/returns',bearer(),'POST',{...returns(),quantity:'1'})).status).toBe(409);
 expect((await call(`/companies/${ids.a}/inventory/entries/${returned.id}/reverse`,bearer(),'POST',{idempotency_key:crypto.randomUUID(),reason:'Must stay closed'})).status).toBe(409);
 await expect(asUser(db,ids.adminA,ids.a,()=>db.query("update app.production_orders set status='in_production',version=version+1 where id=$1",[order.id]))).rejects.toThrow();
 await expect(asUser(db,ids.adminA,ids.a,()=>db.query("update app.production_orders set problem='changed',version=version+1 where id=$1",[order.id]))).rejects.toThrow();
 await expect(db.query('delete from app.production_closures where id=$1',[closed.id])).rejects.toThrow();
 const rights=(await db.query<any>("select has_function_privilege('app_backend','app_private.post_production_closure()','EXECUTE') invoke,has_column_privilege('app_backend','app.production_closures','snapshot','INSERT') forge,has_column_privilege('app_backend','app.inventory_entries','production_closure_id','INSERT') consume,has_table_privilege('app_backend','app.stock_balances','UPDATE') balances,has_table_privilege('authenticated','app.production_closures','SELECT') browser")).rows[0];expect(rights).toEqual({invoke:false,forge:false,consume:false,balances:false,browser:false});
 const other=await asUser(db,ids.adminB,ids.b,()=>db.query('select * from app.production_closures where id=$1',[closed.id]),ids.sessionB);expect(other.rows).toHaveLength(0);
 await expect(asUser(db,ids.adminB,ids.b,()=>db.query('select app.production_close_review($1,$2)',[ids.a,order.id]),ids.sessionB)).rejects.toThrow();
});

it('role administration accepts the production permissions needed by operators and closers',async()=>{
 const permissions=['production.read','inventory.read','masterdata.read','production.manage','production.close','production.return','inventory.transfer','production.issue','production.record','production.correct'];
 const r=await call(`/companies/${ids.a}/roles`,bearer(),'POST',{name:'Local close operators',permissions});expect(r.status).toBe(201);
 const role=await r.json();expect((await call(`/companies/${ids.a}/roles/${role.id}`,bearer(),'PATCH',{name:'Local close operators updated',permissions})).status).toBe(200);
 const roles=await(await call(`/companies/${ids.a}/roles`,bearer())).json();expect(roles.find((x:any)=>x.id===role.id).permissions.sort()).toEqual(permissions.sort());
});
