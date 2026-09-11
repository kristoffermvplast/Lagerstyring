import { beforeAll, afterAll, it, expect } from 'vitest';
import { fixture, ids, asUser } from './helpers/access-fixture';
let db:Awaited<ReturnType<typeof fixture>>,root:string,child:string,leaf:string;
const actor=<T>(work:()=>Promise<T>)=>asUser(db,ids.adminA,ids.a,work);
async function create(code:string,parent:string|null=null,active=true){return(await db.query<{id:string}>('insert into app.locations(company_id,code,name,parent_id,active) values($1,$2,$2,$3,$4) returning id',[ids.a,code,parent,active])).rows[0].id;}
beforeAll(async()=>{db=await fixture();await actor(async()=>{root=await create('SITE');child=await create('HALL',root);leaf=await create('SHELF',child);});});
afterAll(async()=>{await db?.close();});
it('stores hierarchy with stable identities, free type labels and immutable audit',async()=>{await actor(async()=>{
 await db.query("update app.locations set name='Renamed hall',location_type='User-defined level',version=version+1 where id=$1",[child]);
 expect((await db.query<any>('select parent_id from app.locations where id=$1',[leaf])).rows[0].parent_id).toBe(child);
 const audit=(await db.query<any>("select before_value,after_value from app.masterdata_audit where entity_type='locations' and entity_id=$1 and action='UPDATE'",[child])).rows[0];expect(audit.before_value.name).toBe('HALL');expect(audit.after_value.location_type).toBe('User-defined level');
});});
it('rejects direct and indirect cycles, including moving a populated branch into its descendant',async()=>{
 for(const[id,parent]of[[root,root],[root,leaf],[child,leaf]])await expect(actor(()=>db.query('update app.locations set parent_id=$2,version=version+1 where id=$1',[id,parent]))).rejects.toMatchObject({code:'23514'});
 await actor(async()=>{expect((await db.query<any>('select parent_id from app.locations where id=$1',[root])).rows[0].parent_id).toBeNull();});
});
it('bounds subtree depth and rolls back rejected hierarchy changes',async()=>{
 let end:string;
 await actor(async()=>{let parent:string|null=null;for(let i=1;i<=32;i++)parent=await create('DEPTH-'+i,parent);end=parent!;});
 await expect(actor(()=>create('TOO-DEEP',end))).rejects.toMatchObject({code:'23514'});
 await expect(actor(()=>db.query('update app.locations set parent_id=$2,version=version+1 where id=$1',[root,end]))).rejects.toMatchObject({code:'23514'});
});
it('requires active ancestors and deliberate bottom-up deactivation',async()=>{
 await expect(actor(()=>db.query('update app.locations set active=false,version=version+1 where id=$1',[child]))).rejects.toMatchObject({code:'23514'});
 await actor(async()=>{await db.query('update app.locations set active=false,version=version+1 where id=$1',[leaf]);await db.query('update app.locations set active=false,version=version+1 where id=$1',[child]);});
 await expect(actor(()=>db.query('update app.locations set active=true,version=version+1 where id=$1',[leaf]))).rejects.toMatchObject({code:'23514'});
 await expect(actor(()=>create('INVALID-ACTIVE',child))).rejects.toMatchObject({code:'23514'});
 await actor(async()=>{await db.query('update app.locations set parent_id=null,active=true,version=version+1 where id=$1',[child]);await db.query('update app.locations set active=true,version=version+1 where id=$1',[leaf]);});
});
it('preserves the privilege boundary and serializes writes through a private company gate',async()=>{
 const gate=await db.query<any>('select revision from app_private.location_tree_locks where company_id=$1',[ids.a]);expect(Number(gate.rows[0].revision)).toBeGreaterThan(1);
 for(const sql of ['select * from app_private.location_tree_locks','delete from app.locations','update app.locations set company_id=company_id','update app.locations set created_at=now()','delete from app.masterdata_audit'])await expect(actor(()=>db.exec(sql))).rejects.toMatchObject({code:'42501'});
 await expect(actor(()=>db.query("update app.locations set name='No version' where id=$1",[root]))).rejects.toMatchObject({code:'23514'});
 for(const role of ['anon','authenticated','service_role']){await db.exec('BEGIN; SET LOCAL ROLE '+role);try{await expect(db.exec('select * from app.locations')).rejects.toMatchObject({code:'42501'});}finally{await db.exec('ROLLBACK');}}
});
it('isolates company data and denies reader writes and case-insensitive duplicate codes',async()=>{
 await asUser(db,ids.adminB,ids.b,async()=>{expect((await db.query('select * from app.locations')).rows).toHaveLength(0);expect((await db.query('select * from app.masterdata_audit')).rows).toHaveLength(0);},ids.sessionB);
 await expect(asUser(db,ids.adminB,ids.b,()=>db.query("insert into app.locations(company_id,code,name,parent_id) values($1,'BAD','BAD',$2)",[ids.b,root]),ids.sessionB)).rejects.toMatchObject({code:'23514'});
 await db.query("insert into app.role_permissions values($1,$2,'masterdata.read')",[ids.a,ids.readRole]);
 await asUser(db,ids.reader,ids.a,async()=>{expect((await db.query('select * from app.locations')).rows.length).toBeGreaterThan(0);},ids.sessionRead);
 await expect(asUser(db,ids.reader,ids.a,()=>db.query("insert into app.locations(company_id,code,name) values($1,'NO','NO')",[ids.a]),ids.sessionRead)).rejects.toMatchObject({code:'42501'});
 await expect(actor(()=>create('site'))).rejects.toMatchObject({code:'23505'});
});
it('validates item and machine references, retaining existing references when a location is deactivated',async()=>{
 let loc:string,nonstorage:string,item:string;
 await actor(async()=>{
  loc=await create('ASSIGN');nonstorage=await create('AREA');await db.query('update app.locations set is_storage=false,version=version+1 where id=$1',[nonstorage]);
  item=(await db.query<any>("insert into app.items(company_id,kind,code,name,standard_location_id) values($1,'material','MAT','MAT',$2) returning id",[ids.a,loc])).rows[0].id;
  await db.query("insert into app.machines(company_id,code,name,location_id) values($1,'MAC','MAC',$2)",[ids.a,nonstorage]);
  await db.query('update app.locations set active=false,version=version+1 where id=$1',[loc]);
  await db.query("update app.items set name='Same retained location',version=version+1 where id=$1",[item]);
 });
 for(const target of [loc,nonstorage])await expect(actor(()=>db.query("insert into app.items(company_id,kind,code,name,standard_location_id) values($1,'packaging','BAD','BAD',$2)",[ids.a,target]))).rejects.toMatchObject({code:'23514'});
 await expect(asUser(db,ids.adminB,ids.b,()=>db.query("insert into app.machines(company_id,code,name,location_id) values($1,'FOREIGN','FOREIGN',$2)",[ids.b,nonstorage]),ids.sessionB)).rejects.toMatchObject({code:'23514'});
});
