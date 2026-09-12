import {beforeAll,afterAll,it,expect} from 'vitest';
import {randomUUID} from 'node:crypto';
import {fixture,ids,asUser} from './helpers/access-fixture';
let db:Awaited<ReturnType<typeof fixture>>,item:string,owner:string,external:string,location:string,unit:string,first:string;
const actor=<T>(work:()=>Promise<T>)=>asUser(db,ids.adminA,ids.a,work);
const rows=(quantity:string,o=owner)=>[{item_id:item,owner_id:o,location_id:location,quantity}];
async function post(lines:any[],kind='correction',reverses:string|null=null,key=randomUUID()) {return(await db.query<any>('insert into app.inventory_entries(company_id,idempotency_key,kind,reason,request,reverses_id) values($1,$2,$3,$4,$5,$6) returning id',[ids.a,key,kind,'Count correction',JSON.stringify(lines),reverses])).rows[0].id;}
beforeAll(async()=>{db=await fixture();await actor(async()=>{
 unit=(await db.query<any>("insert into app.units(company_id,code,name,symbol,dimension) values($1,'KG','Kilogram','kg','mass') returning id",[ids.a])).rows[0].id;
 item=(await db.query<any>("insert into app.items(company_id,kind,code,name,unit_id) values($1,'material','MAT','Material',$2) returning id",[ids.a,unit])).rows[0].id;
 location=(await db.query<any>("insert into app.locations(company_id,code,name) values($1,'LOC','Location') returning id",[ids.a])).rows[0].id;
 for(const kind of ['company','other']){const id=(await db.query<any>('insert into app.stock_owners(company_id,code,name,kind) values($1,$2,$2,$2) returning id',[ids.a,kind])).rows[0].id;if(kind==='company')owner=id;else external=id;}
});});
afterAll(()=>db.close());
it('posts exact decimal quantities with actor and immutable masterdata snapshots',async()=>{await actor(async()=>{
 first=await post(rows('0.00825001'));const line=(await db.query<any>('select * from app.inventory_lines where entry_id=$1',[first])).rows[0];expect(line.quantity).toBe('0.00825001');expect(line.snapshot.location_path[0].name).toBe('Location');
 expect((await db.query<any>('select actor_id from app.inventory_entries where id=$1',[first])).rows[0].actor_id).toBe(ids.adminA);
 await db.query("update app.items set name='Changed name',version=version+1 where id=$1",[item]);expect((await db.query<any>('select snapshot from app.inventory_lines where entry_id=$1',[first])).rows[0].snapshot.item.name).toBe('Material');
});});
it('separates external ownership and cannot debit another owner balance',async()=>{await actor(()=>post(rows('100',external)));await expect(actor(()=>post(rows('-1')))).rejects.toMatchObject({code:'23514'});});
it('rolls back every line, journal and balance when one debit fails',async()=>{
 const before=(await db.query<any>('select count(*)::int n from app.inventory_entries')).rows[0].n;
 await expect(actor(()=>post([...rows('1'),...rows('-101',external)]))).rejects.toMatchObject({code:'23514'});
 expect((await db.query<any>('select count(*)::int n from app.inventory_entries')).rows[0].n).toBe(before);
 expect((await db.query<any>('select quantity from app.stock_balances where owner_id=$1',[owner])).rows[0].quantity).toBe('0.00825001');
});
it('allows a complete compensating reversal once without rewriting original entries',async()=>{
 const reversal=await actor(()=>post([],'reversal',first));expect(reversal).not.toBe(first);
 expect((await db.query<any>('select quantity from app.stock_balances where owner_id=$1',[owner])).rows[0].quantity).toBe('0.00000000');
 await expect(actor(()=>post([],'reversal',first))).rejects.toMatchObject({code:'23505'});
 await expect(actor(()=>post([],'reversal',reversal))).rejects.toMatchObject({code:'23514'});
});
it('rejects duplicate dimensions, forged snapshots, zero, invalid decimals and excess precision',async()=>{
 for(const input of [[...rows('1'),...rows('2')],[{...rows('1')[0],snapshot:{}}],rows('0'),rows('NaN'),rows('0.000000001'),rows('1e3'),rows('1000000000000')])await expect(actor(()=>post(input))).rejects.toMatchObject({code:'23514'});
});
it('enforces least privilege, session and company isolation at database boundary',async()=>{
 for(const sql of ['update app.stock_balances set quantity=1','delete from app.inventory_entries','delete from app.inventory_lines','insert into app.stock_balances default values','select app_private.post_inventory()'])await expect(actor(()=>db.exec(sql))).rejects.toMatchObject({code:'42501'});
 await db.query("insert into app.role_permissions values($1,$2,'inventory.read')",[ids.a,ids.readRole]);
 await asUser(db,ids.reader,ids.a,async()=>{expect((await db.query('select * from app.stock_balances')).rows.length).toBe(2);},ids.sessionRead);
 await expect(asUser(db,ids.reader,ids.a,()=>post(rows('1')),ids.sessionRead)).rejects.toMatchObject({code:'42501'});
 await asUser(db,ids.adminB,ids.b,async()=>{for(const table of ['inventory_entries','inventory_lines','stock_balances','stock_owners'])expect((await db.query('select * from app.'+table)).rows).toHaveLength(0);},ids.sessionB);
 await expect(asUser(db,ids.adminB,ids.b,()=>db.query("insert into app.inventory_entries(company_id,idempotency_key,kind,reason,request) values($1,$2,'correction','Invalid foreign key',$3)",[ids.b,randomUUID(),JSON.stringify(rows('1'))]),ids.sessionB)).rejects.toMatchObject({code:'23514'});
});
it('blocks incoming stock to inactive locations but permits correction of remaining stock out',async()=>{
 await actor(()=>db.query('update app.locations set active=false,version=version+1 where id=$1',[location]));
 await expect(actor(()=>post(rows('1')))).rejects.toMatchObject({code:'23514'});
 await actor(()=>post(rows('-1',external)));
});
it('reconstructs every balance exactly from the immutable ledger including zero balances',async()=>{
 const r=await db.query<any>('select b.quantity=sum(l.quantity) as matches from app.stock_balances b join app.inventory_lines l using(company_id,item_id,owner_id,location_id,unit_id) group by b.company_id,b.item_id,b.owner_id,b.location_id,b.quantity');expect(r.rows.every(x=>x.matches)).toBe(true);
});
it('blocks ledger rewrites even by its owner and rejects revoked sessions',async()=>{
 await expect(db.exec("update app.inventory_entries set reason='Rewrite'")).rejects.toMatchObject({code:'23514'});
 await expect(db.exec('delete from app.inventory_lines')).rejects.toMatchObject({code:'23514'});
 await db.query('insert into app.revoked_sessions(session_id,user_id) values($1,$2)',[ids.session,ids.adminA]);
 await expect(actor(()=>post(rows('-1',external)))).rejects.toMatchObject({code:'42501'});
});
