import {createRequire} from 'node:module';
import {beforeAll,afterAll,it,expect} from 'vitest';
import {fixture,ids,asUser} from './helpers/access-fixture';
const require=createRequire(import.meta.url);
const {StockCountsController}=require('../apps/api/dist/stock-counts.js');
let db:Awaited<ReturnType<typeof fixture>>,controller:any,item:string,owner:string,location:string;
const actor={userId:ids.adminA,sessionId:ids.session},reader={userId:ids.reader,sessionId:ids.sessionRead};
const key=()=>crypto.randomUUID();
const admin=<T>(work:()=>Promise<T>)=>asUser(db,ids.adminA,ids.a,work);
const move=(quantity:string)=>admin(()=>db.query("insert into app.inventory_entries(company_id,idempotency_key,kind,reason,request) values($1,$2,'correction','Count fixture',$3)",[ids.a,key(),JSON.stringify([{item_id:item,owner_id:owner,location_id:location,quantity}])]));
const begin=()=>controller.start({actor},ids.a,{idempotency_key:key(),reason:'Start physical count',item_id:item,owner_id:owner,location_id:location});
const action=async(c:any,a:string,data={})=>controller.change({actor},ids.a,c.id,a,{idempotency_key:key(),version:c.version,reason:'Count test action',...data});
const balance=async()=>(await db.query<any>('select quantity,reserved_quantity,physical_revision::text from app.stock_balances where item_id=$1',[item])).rows[0];
beforeAll(async()=>{
 db=await fixture();
 controller=new StockCountsController({asActor:(a:any,c:string,work:any)=>asUser(db,a.userId,c,()=>work({query:async(sql:string,values?:unknown[])=>{const r=await db.query(sql,values);return {rows:r.rows};}}),a.sessionId)});
 await admin(async()=>{
 const unit=(await db.query<any>("insert into app.units(company_id,code,name,symbol,dimension) values($1,'KG','Kilogram','kg','mass') returning id",[ids.a])).rows[0].id;
 item=(await db.query<any>("insert into app.items(company_id,kind,code,name,unit_id) values($1,'material','M','Count material',$2) returning id",[ids.a,unit])).rows[0].id;
 owner=(await db.query<any>("insert into app.stock_owners(company_id,code,name,kind) values($1,'OWN','Owner','company') returning id",[ids.a])).rows[0].id;
 location=(await db.query<any>("insert into app.locations(company_id,code,name) values($1,'L','Location') returning id",[ids.a])).rows[0].id;
 });await move('100');
});
afterAll(async()=>{await db?.close();});
it('records without changing stock; approval journals exact decimal difference once',async()=>{
 let c=await begin();expect(c.baseline_quantity).toBe('100.00000000');const before=await balance();
 c=await action(c,'record',{quantity:'90.00000001'});expect(await balance()).toEqual(before);
 const input={idempotency_key:key(),version:c.version,reason:'Approve count result'};
 const a=await controller.change({actor},ids.a,c.id,'approve',input);expect(a.status).toBe('approved');expect(a.entry_id).toBeTruthy();
 expect(await controller.change({actor},ids.a,c.id,'approve',input)).toEqual(a);
 expect((await balance()).quantity).toBe('90.00000001');
 expect((await db.query<any>('select quantity from app.inventory_lines where entry_id=$1',[a.entry_id])).rows[0].quantity).toBe('-9.99999999');
 await expect(controller.change({actor},ids.a,c.id,'approve',{...input,reason:'Different payload'})).rejects.toMatchObject({status:409});
 const detail=await controller.get({actor},ids.a,c.id);expect(detail.events).toHaveLength(3);expect(detail.difference).toBe('-9.99999999');
});
it('rejects stale counts even after movements net back to the original quantity',async()=>{
 let c=await begin();c=await action(c,'record',{quantity:'80'});await move('1');await move('-1');
 expect((await controller.get({actor},ids.a,c.id)).stale).toBe(true);
 await expect(action(c,'approve')).rejects.toMatchObject({code:'23514'});
 await expect(action(c,'record',{quantity:'85'})).rejects.toMatchObject({code:'23514'});
 expect((await balance()).quantity).toBe('90.00000001');await action(c,'cancel');
});
it('protects reservations; explicit release allows the same approval request without recount',async()=>{
 const reservation=key();await admin(()=>db.query("insert into app.reservation_events(company_id,idempotency_key,kind,reservation_id,reason,request) values($1,$2,'reserve',$2,'Count reservation',$3)",[ids.a,reservation,JSON.stringify({item_id:item,owner_id:owner,location_id:location,handling_unit_id:null,quantity:'80',reference:'Protected'})]));
 let c=await begin();c=await action(c,'record',{quantity:'70'});const before=await balance();
 const input={idempotency_key:key(),version:c.version,reason:'Approve after review'};
 await expect(controller.change({actor},ids.a,c.id,'approve',input)).rejects.toMatchObject({code:'23514'});
 expect(await balance()).toEqual(before);expect((await controller.get({actor},ids.a,c.id)).reservations).toHaveLength(1);
 await admin(()=>db.query("insert into app.reservation_events(company_id,idempotency_key,kind,reservation_id,reason,request) values($1,$2,'release',$3,'Explicit release','{}')",[ids.a,key(),reservation]));
 expect((await balance()).physical_revision).toBe(before.physical_revision);
 expect((await controller.change({actor},ids.a,c.id,'approve',input)).status).toBe('approved');expect((await balance()).quantity).toBe('70.00000000');
});
it('zero difference approves without an artificial inventory entry; zero count is valid',async()=>{
 let c=await begin();c=await action(c,'record',{quantity:'70'});const a=await action(c,'approve');expect(a.entry_id).toBeNull();
 c=await begin();c=await action(c,'record',{quantity:'0'});await action(c,'approve');expect((await balance()).quantity).toBe('0.00000000');
});
it('rejects duplicate open counts, forged values, stale versions and unknown IDs',async()=>{
 const c=await begin();await expect(begin()).rejects.toMatchObject({code:'23505'});
 for(const quantity of ['-1','1e2','NaN','0.000000001'])await expect(action(c,'record',{quantity})).rejects.toMatchObject({status:400});
 await expect(action({...c,version:999},'record',{quantity:'1'})).rejects.toMatchObject({code:'23514'});
 await expect(controller.get({actor},ids.a,key())).rejects.toMatchObject({status:404});
 await expect(admin(()=>db.query("insert into app.count_events(company_id,idempotency_key,count_id,action,reason,request) values($1,$2,$3,'record','Forged command',$4)",[ids.a,key(),c.id,JSON.stringify({version:1,quantity:null})]))).rejects.toMatchObject({code:'23514'});
 await action(c,'cancel');
});
it('enforces read/manage/approval separation and tenant isolation, and denies direct writes',async()=>{
 for(const code of ['inventory.read','counts.read','counts.manage'])await db.query('insert into app.role_permissions values($1,$2,$3)',[ids.a,ids.readRole,code]);
 const c=await controller.start({actor:reader},ids.a,{idempotency_key:key(),reason:'Reader can count',item_id:item,owner_id:owner,location_id:location});
 await expect(controller.change({actor:reader},ids.a,c.id,'approve',{idempotency_key:key(),reason:'No approval right',version:1})).rejects.toMatchObject({status:403});
 await expect(controller.list({actor},ids.b,{})).rejects.toMatchObject({status:403});
 expect(await asUser(db,ids.adminB,ids.b,async()=>(await db.query('select * from app.stock_counts')).rows,ids.sessionB)).toEqual([]);
 for(const sql of ['update app.stock_counts set status=\'approved\'','delete from app.count_events','update app.stock_balances set physical_revision=0'])await expect(admin(()=>db.exec(sql))).rejects.toBeDefined();
 const grants=(await db.query<any>("select has_table_privilege('anon','app.stock_counts','SELECT') a,has_table_privilege('authenticated','app.count_events','INSERT') b,has_function_privilege('app_runtime','app_private.command_count()','EXECUTE') c")).rows[0];expect(grants).toEqual({a:false,b:false,c:false});
 await action(c,'cancel');
});

it('countable units require integers and direct commands cannot inject extra fields',async()=>{
 const countItem=await admin(async()=>{
 const u=(await db.query<any>("insert into app.units(company_id,code,name,symbol,dimension) values($1,'PCS','Pieces','pcs','count') returning id",[ids.a])).rows[0].id;
 const i=(await db.query<any>("insert into app.items(company_id,kind,code,name,unit_id) values($1,'packaging','PCS','Pieces',$2) returning id",[ids.a,u])).rows[0].id;
 await db.query("insert into app.inventory_entries(company_id,idempotency_key,kind,reason,request) values($1,$2,'correction','Pieces fixture',$3)",[ids.a,key(),JSON.stringify([{item_id:i,owner_id:owner,location_id:location,quantity:'5'}])]);return i;
 });
 const c=await controller.start({actor},ids.a,{idempotency_key:key(),reason:'Count whole units',item_id:countItem,owner_id:owner,location_id:location});await expect(action(c,'record',{quantity:'0.5'})).rejects.toMatchObject({code:'23514'});
 await expect(admin(()=>db.query("insert into app.count_events(company_id,idempotency_key,count_id,action,reason,request) values($1,$2,$3,'record','Forged extra field',$4)",[ids.a,key(),c.id,JSON.stringify({version:1,quantity:'1',baseline_quantity:'999'})]))).rejects.toMatchObject({code:'23514'});
 await action(c,'cancel');
});
it('foreign balance references and revoked sessions cannot start a count',async()=>{
 await expect(controller.start({actor},ids.a,{idempotency_key:key(),reason:'Foreign reference',item_id:ids.b,owner_id:owner,location_id:location})).rejects.toMatchObject({code:'23514'});
 await db.query('delete from auth.sessions where id=$1',[ids.session]);await expect(begin()).rejects.toMatchObject({code:'42501'});
 await db.query('insert into auth.sessions values($1,$2)',[ids.session,ids.adminA]);
});
